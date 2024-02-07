const admin = require('firebase-admin');
// const dblib = require('firebase-admin/database');
const serviceAccount = require("./creds.json");
const express = require('express');
const cors = require('cors');
const bodyparser = require('body-parser');

console.log("Initializing firebase app...");
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://gymkhanacalendar-default-rtdb.asia-southeast1.firebasedatabase.app"
});
console.log("Firebase initialized");

console.log("Test route password: ", process.env.PASS);

const db = admin.database();
const msg = admin.messaging();

//on start: get all notifications data and approved event keys from db, set up two objects - notifwise and userwise - notif wise has keys = event keys and values = object of usertokens subscribed to those events, userwise has keys = usetokens and values = object of event keys subscribed to (for quick response to getSubscribedEvents)
/*db structure:
notifs
|-event key 1 {
	|-usertoken1:true
	|-usertoken2:true
	...}
|-event key 2 {...}
*/

const notifs = db.ref("notifications");
const events = db.ref("approved");

let notifwise = {};
let userwise = {};

//for storing valid keys of events to validate incoming subscribe requests
//value of key: start time
let eventkeys = {};

//for storing timeout ids of events
let timeouts = {};

function thirtyMin(name) {
	return {
		notification: {
			title: `${name} will begin in 30 minutes.`,
			body: "Please visit the Gymkhana Calendar to view more details"
		}
	}
}

function fiveMin(name) {
	return {
		notification: {
			title: `${name} will begin in 5 minutes!`,
			body: "Please visit the Gymkhana Calendar to view more details"
		}
	}
}

console.log("Fetching notifs data...");
notifs.once("value", (snapshot) => {
	console.log("Loading initial notifs data...");
// 	console.log(snapshot.val());
	notifwise = snapshot.val();
	if (notifwise === null) notifwise = {};
	snapshot.forEach((event) => {
		for (const user of Object.keys(event.val())) {
			if (userwise[user] === undefined) {
				userwise[user] = {[event.key]: true};
			} else {
				userwise[user][event.key] = true;
			}
		}
	});
	console.log("Loaded initial notifs data, logging:");
	console.log(notifwise);
	console.log("Userwise:");
	console.log(userwise);
});

//no need to do a once() because onchild etc. already send initial data via child_added (one by one)

//use onchild, etc. handlers for event updates so that notification dispatching code is easy to write
//on child added: add event key to eventkeys
//only go through events that haven't occurred yet
events.orderByChild('date').startAt(Date.now()).on("child_added", (snapshot) => {
	console.log(`New event approved, key: ${snapshot.key}`);
	const name = snapshot.val().name;
	const date = snapshot.val().date;
	eventkeys[snapshot.key] = {
		name,
		date
	};
	//add timeout if necessary
	const time_dist = date - Date.now();
	if (time_dist < 1000*60*90 && time_dist > 1000*60*30) {
		addAlarm(snapshot.key, date - 1000*60*30, sendNotifications.bind(this, snapshot.key, thirtyMin(name)));
	}
	if (time_dist < 1000*60*60 && time_dist > 1000*60*5) {
		addAlarm(snapshot.key, date - 1000*60*5, sendNotifications.bind(this, snapshot.key, fiveMin(name)));
	}
});
//on child changed: event details changed -> send notification with updates
events.on("child_changed", (snapshot) => {
	console.log(`Event changed, key: ${snapshot.key}`);
	//send out update notifications
	sendNotifications(snapshot.key, {
		notification: {
			title: `Change in details for ${eventkeys[snapshot.key]['name']}.`,
			body: "Please visit the Gymkhana Calendar to view more details."
		}
	});
	//update details AFTER sending the notification using the OLD name
	const name = snapshot.val().name;
	const date = snapshot.val().date;
	eventkeys[snapshot.key] = {
		name,
		date
	};
	//clear timeout and set new one if necessary (using new start time)
	deleteAlarms(snapshot.key);
	const time_dist = date - Date.now();
	if (time_dist < 1000*60*90 && time_dist > 1000*60*30) {
		addAlarm(snapshot.key, date - 1000*60*30, sendNotifications.bind(this, snapshot.key, thirtyMin(name)));
	}
	if (time_dist < 1000*60*60 && time_dist > 1000*60*5) {
		addAlarm(snapshot.key, date - 1000*60*5, sendNotifications.bind(this, snapshot.key, fiveMin(name)));
	}
});
//on child removed: event removed -> send deletion notification and remove entries from objects
events.on("child_removed", async (snapshot) => {
	console.log(`Event cancelled, key: ${snapshot.key}`);
	//send out cancellation notifications
	sendNotifications(snapshot.key, {
		notification: {
			title: `${eventkeys[snapshot.key]['name']} has been cancelled.`,
			body: "We are sorry for the inconvenience caused."
		}
	});
	//remove event timeout if present
	deleteAlarms(snapshot.key);
	//delete from data structures
	delete notifwise[snapshot.key];
	delete eventkeys[snapshot.key];
	for (const user of Object.keys(userwise)) {
		delete userwise[user][snapshot.key];
	}
	await notifs.child(snapshot.key).remove(() => {});
});

function addAlarm(key, time, callback) {
	console.log(`Alarm being set for ${key}, will go off in ~${Math.round((time - Date.now())/(1000*60))} minutes`)
	if (timeouts[key] === undefined) { //new event/deleteAlarms was called
		timeouts[key] = [setTimeout(callback, time - Date.now())];
	} else {
		timeouts[key] = [...timeouts[key], setTimeout(callback, time - Date.now())];
	}
}

function deleteAlarms(key) {
	if (!Array.isArray(timeouts[key])) {
		console.log(`deleteAlarms called on ${key} which has no timers`);
		return;
	}
	for (const alarm of timeouts[key]) {
		clearTimeout(alarm);
	}
	delete timeouts[key];
}

async function sendNotifications(key, message) {
	console.log(`Sending notifications now for event ${key}`);
	console.log(notifwise[key]);
	if (notifwise[key] === undefined || notifwise[key].length === 0) {
		console.log(`No subscribers for ${key}, so no notifications were sent`);
		return;
	}
	let allTokens = Object.keys(notifwise[key]);
	for (let i = 0; i < Math.trunc(allTokens.length/500) + 1; i++) {
		console.log("Sending batch of messages...");
		let tokensArr = allTokens.slice(i*500, i*500+500);
		console.log("Tokens array: ", tokensArr);
		try {
			const resp = await msg.sendEachForMulticast({
				...message,
				tokens: tokensArr
			});
			console.log(`Successful sends: ${resp.successCount}, total: ${tokensArr.length}`);
		} catch (err) {
			console.log(`Error in sending messages for ${key}`);
			console.log(err);
		}
	}
}

//set up setTimeouts for events or 30min. reminders in the coming hour, this is done every hour
function setEventAlarms() {
	console.log(`Setting timeouts, current Date.now(): ${Date.now()}`);
	//sets timeouts for aforementioned events as well as the next hour
	for (const [event, {name, time}] of Object.entries(eventkeys)) {
		const time_dist = time - Date.now();
		if (time_dist < 0) {
			//clear out events that have already occurred
			console.log(`Culling ${event}`);
			for (const user of Object.keys(userwise)) {
				delete userwise[user][event];
			}
			delete notifwise[event];
			notifs.child(event).remove(() => {});
			delete eventkeys[event];
			continue;
		}
		if (time_dist > 1000*60*96) continue; //event is more than 95 minutes away (1 minute leeway) -> take no action, everything handled on next hour
		console.log(`Setting timeout for event key ${event} taking place at ${time}`);
		deleteAlarms(event);
		if (time_dist > 1000*60*60) {
			//more than an hour away -> set timeout for 30 minutes before notification only
			console.log("More than an hour away");
			addAlarm(event, time - 1000*60*30, sendNotifications.bind(this, snapshot.key, thirtyMin(name)));
		} else if (time_dist > 1000*60*30) {
			//between 30 minutes and an hour away -> set timeout for 30 minutes before and 5 minutes before notifications
			console.log("More than 30 minutes away");
			addAlarm(event, time - 1000*60*30, sendNotifications.bind(this, snapshot.key, thirtyMin(name)));
			addAlarm(event, time - 1000*60*5, sendNotifications.bind(this, snapshot.key, fiveMin(name)));
		} else {
			//less than 30 minutes away -> only set timeout for 5 minutes before notification
			console.log("Less than 30 minutes away");
			addAlarm(event, time - 1000*60*5, sendNotifications.bind(this, snapshot.key, fiveMin(name)));
		}
	}
}

setInterval(setEventAlarms, 1000*60*60); //every hour

const server = express();
const port = process.env.PORT || 6001;

async function subscribeUser(userid, eventkey) {
	//assumes valid userid
	if (notifwise[eventkey] === undefined) notifwise[eventkey] = {[userid]: true};
	else notifwise[eventkey][userid] = true;
	if (userwise[userid] === undefined) userwise[userid] = {[eventkey]: true};
	else userwise[userid][eventkey] = true;
	await notifs.update({
		[`${eventkey}/${userid}`]: true
	});
}

async function unsubscribeUser(userid, eventkey) {
	if (notifwise[eventkey] === undefined) throw new Error("Invalid event");
	if (userwise[userid] === undefined) throw new Error("Data mismatch");
	delete notifwise[eventkey][userid];
	delete userwise[userid][eventkey];
	await notifs.update({
		[`${eventkey}/${userid}`]: null
	});
}

server.use(cors());

server.get('/getSubscribedEvents', (req, res) => {
	let userid = req.query.id;
	if (userid === undefined) {
		res.status(404).json([]);
		return;
	}
	if (userwise[userid] === undefined) {
		res.status(200).json([]);
		return;
	}
	res.status(200).json(Object.keys(userwise[userid]));
});

server.post("/subscribeToEvent", bodyparser.json({type: "*/*"}), async (req, res) => {
	let userid = String(req.body.userid);
	let eventkey = String(req.body.eventkey);
// 	console.log(req.body);
	console.log(`Token ${userid} subscribing to ${eventkey}`);
// 	console.log(userid);
// 	console.log(eventkey);
	if (userid === "undefined" || eventkey === "undefined" || eventkeys[eventkey] === undefined) {
		res.status(400).json({"error":"Invalid user token or event key"});
		return;
	}
	//send dry run message to user token to confirm that this is a valid user token
	//(since all user token data comes from a client, none of it can be trusted -> can't
	//just use the getSubscribedEvents method to log valid user tokens)
	try {
		await msg.send({
			data: {test: ""},
			token: userid
		}, true);
	} catch(err) {
		console.log(`Invalid user token passed: ${userid}`);
		console.log(err);
		res.status(500).json({"error":"Failed to validate user token"});
		return;
	}
	//eventkey and userid validated, so we're good to go - add to userwise and notifwise and add to realtime db
	try {
		await subscribeUser(userid, eventkey);
	} catch (err) {
		console.log("Failed to subscribe user to event");
		console.log(err);
		res.status(500).json({"error":"Failed to subscribe user to event"});
		return;
	}
	//we're done!
	console.log(`Successfully subscribed ${userid} to ${eventkey}`);
	res.status(200).json({"error":"None"});
});

server.post("/unsubscribeFromEvent", bodyparser.json({type: "*/*"}), async (req, res) => {
	let userid = req.body.userid;
	let eventkey = req.body.eventkey;
	console.log(`Token ${userid} unsubscribing from ${eventkey}`);
	if (userid === "undefined" || eventkey === "undefined" || eventkeys[eventkey] === undefined) {
		res.status(400).json({"error":"Invalid user token or event key"});
		return;
	}
	try {
		await unsubscribeUser(userid, eventkey);
	} catch (err) {
		res.status(500).json({"error":err});
		return;
	}
	res.status(200).json({"error":"None"});
});

server.post("/test", bodyparser.json({type: "*/*"}), async (req, res) => {
	//test endpoint for sending notifications
	if (req.body.pass !== process.env.PASS) {
		res.status(404).send("Cannot POST /test");
		return;
	}
	console.log("debug send called for ", req.body.id);
	const resp = msg.send({
		notification: {
			title:"Test",
			body:"Test message"
		},
		token: req.body.id
	});
	res.status(200).json(resp);
});

server.listen(port, () => {
	console.log(`Notifications server started on port ${port}`);
});
