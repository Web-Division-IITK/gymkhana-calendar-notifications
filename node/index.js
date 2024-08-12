const admin = require('firebase-admin');
// const dblib = require('firebase-admin/database');
const serviceAccount = require("/run/secrets/firebase");
const express = require('express');
const cors = require('cors');
const bodyparser = require('body-parser');
const redis = require('redis');

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
	if (await redisClient.sCard(`event:${key}`) === 0) {
		console.log(`No subscribers for ${key}, so no notifications were sent`);
		return;
	}
	for await (const tokensArr of redisClient.sScanIterator(`event:${key}`, {COUNT: 500})) {
		console.log("Sending batch of messages...");
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
async function setEventAlarms() {
	console.log(`Setting timeouts, current Date.now(): ${Date.now()}`);	
	const events = await redisClient.ft.search("idx:event", `@date: [-inf ${Date.now() + 1000*60*96}]]`, {LIMIT: {from: 0, size: 100000}});
	for (const {id: eventRedisKey, value: {name, date}} of events.documents) {
		const time_dist = date - Date.now();
		const event = eventRedisKey.slice("event:".length);
		if (time_dist < 0) {
			//clear out events that have already occurred
			console.log(`Culling ${event}`);
			const users = await redisClient.sMembers(eventRedisKey);
			await Promise.all(
			    [ ...users.map( el => redisClient.sRem(`user:${el}`, event) ),
			    redisClient.del(eventRedisKey),
			    redisClient.sRem("eventkeys", event)
			    ]
			); 
			continue;
		}
		console.log(`Setting timeout for event key ${event} taking place at ${time}`);
		deleteAlarms(event);
		if (time_dist > 1000*60*60) {
			//more than an hour away -> set timeout for 30 minutes before notification only
			console.log("More than an hour away");
			addAlarm(event, time - 1000*60*30, sendNotifications.bind(this, event, thirtyMin(name)));
		} else if (time_dist > 1000*60*30) {
			//between 30 minutes and an hour away -> set timeout for 30 minutes before and 5 minutes before notifications
			console.log("More than 30 minutes away");
			addAlarm(event, time - 1000*60*30, sendNotifications.bind(this, event, thirtyMin(name)));
			addAlarm(event, time - 1000*60*5, sendNotifications.bind(this, event, fiveMin(name)));
		} else {
			//less than 30 minutes away -> only set timeout for 5 minutes before notification
			console.log("Less than 30 minutes away");
			addAlarm(event, time - 1000*60*5, sendNotifications.bind(this, event, fiveMin(name)));
		}
	}
}

async function subscribeUser(userid, eventkey) {
	//assumes valid userid, valid eventkey, should have been validated earlier
	await redisClient.multi()
	    .sAdd(`event:${eventkey}`, userid)
	    .sAdd(`user:${userid}`, eventkey)
	    .exec();
}

async function unsubscribeUser(userid, eventkey) {
	if ((await redisClient.sIsMember("eventkeys", eventkey)) === 0) throw new Error("Invalid event");
	if ((await redisClient.exists(userid)) === 0) throw new Error("Data mismatch");
	await redisClient.multi()
	    .sRem(`event:${eventkey}`, userid)
	    .sRem(`user:${userid}`, eventkey)
	    .exec();
}

function async newEvent(snapshot) {
    console.log(`New event approved, key: ${snapshot.key}`);
	const name = snapshot.val().name;
	const date = snapshot.val().date;
	await redisClient.multi()
	    .hSet(`event:${snapshot.key}`, {name, date})
	    .sAdd("eventkeys", snapshot.key)
        .exec();
	
	//add timeout for notifications if close enough
	const time_dist = date - Date.now();
	if (time_dist < 1000*60*90 && time_dist > 1000*60*30) {
		addAlarm(snapshot.key, date - 1000*60*30, sendNotifications.bind(this, snapshot.key, thirtyMin(name)));
	}
	if (time_dist < 1000*60*60 && time_dist > 1000*60*5) {
		addAlarm(snapshot.key, date - 1000*60*5, sendNotifications.bind(this, snapshot.key, fiveMin(name)));
	}
}

async function changedEvent(snapshot) {
    console.log(`Event changed, key: ${snapshot.key}`);
	const {name, date} = snapshot.val();
	const {name: old_name, date: old_date} = await redisClient.hGetAll(snapshot.key);
	let dateChanged = date !== old_name;
	let nameChanged = name !== old_date;
	const newDate = new Date(date);
	//send out update notifications
	sendNotifications(snapshot.key, {
		notification: {
			title: `Change in details for ${old_name}.`,
			body: `${dateChanged ? "The date has been changed to " + newDate.getDate() + "-" + (newDate.getMonth() + 1) + "-" + newDate.getFullYear() + "\n" : ""}${nameChanged ? "The event has been renamed to " + name + ".\n" : ""}Please visit the Gymkhana Calendar to view more details.`
		}
	});
	if (!(nameChanged || dateChanged)) return;
	await redisClient.hSet(`event:${snapshot.key}`, {name, date});
	//clear timeout and set new one if necessary (using new start time, new name)
    deleteAlarms(snapshot.key);
    const time_dist = date - Date.now();
    if (time_dist < 1000*60*90 && time_dist > 1000*60*30) {
        addAlarm(snapshot.key, date - 1000*60*30, sendNotifications.bind(this, snapshot.key, thirtyMin(name)));
    }
    if (time_dist < 1000*60*60 && time_dist > 1000*60*5) {
        addAlarm(snapshot.key, date - 1000*60*5, sendNotifications.bind(this, snapshot.key, fiveMin(name)));
    }
}

async function removedEvent(snapshot) {
    console.log(`Event cancelled, key: ${snapshot.key}`);
	//send out cancellation notifications
	const name = await redisClient.hGet(`event:${snapshot.key}`, name);
	sendNotifications(snapshot.key, {
		notification: {
			title: `${name} has been cancelled.`,
			body: "We are sorry for the inconvenience caused."
		}
	});
}

async getSubscribedEvents(req, res) {
    let userid = req.query.id;
    if (userid === undefined) {
		res.status(404).json([]);
		return;
	}
	const userEvents = await redisClient.get(`user:${userid}`);
	if (userEvents === null) {
		res.status(200).json([]);
		return;
	}
	res.status(200).json(userEvents)
	
}

async function subscribeToEvent(req, res) {
    let userid = String(req.body.userid);
	let eventkey = String(req.body.eventkey);
	console.log(`Token ${userid} subscribing to ${eventkey}`);
	if (userid === "undefined" 
	|| eventkey === "undefined" 
	|| ((await redisClient.sIsMember("eventkeys", eventkey)) === 0)) {
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
}

async function unsubscribeFromEvent(req, res) {
	let userid = req.body.userid;
	let eventkey = req.body.eventkey;
	console.log(`Token ${userid} unsubscribing from ${eventkey}`);
	if (userid === "undefined" 
	|| eventkey === "undefined" 
	|| ((await redisClient.sIsMember("eventkeys", eventkey)) === 0)) {
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
}

console.log("Initializing firebase app...");
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://gymkhanacalendar-default-rtdb.asia-southeast1.firebasedatabase.app"
});
console.log("Firebase initialized");

console.log("Test route password: ", process.env.PASS);

const db = admin.database();
const msg = admin.messaging();

const events = db.ref("approved");

console.log("Connecting to Redis...")
const redisClient = redis.createClient({
    host: 'redis',
    port: 6379
});

await redisClient.connect();

//create date index
try {
    await redisClient.ft.create('idx:event', {
        date: {
            type: redis.SchemaFieldTypes.NUMERIC
        }
    }, {
        ON: "HASH",
        PREFIX: 'event:'
    });
} catch(err) {
    if (err.message !== "Index already exists ") throw err;
}

const server = express();
const port = 3000;

let timeouts = {};

events.orderByChild('date').startAt(Date.now()).on("child_added", newEvent);
events.on("child_changed", changedEvent);
events.on("child_removed", removedEvent);

setInterval(setEventAlarms, 1000*60*60); //every hour

server.use(cors());

server.get('/getSubscribedEvents', getSubscribedEvents);

server.post("/subscribeToEvent", bodyparser.json({type: "*/*"}), subscribeToEvent);

server.post("/unsubscribeFromEvent", bodyparser.json({type: "*/*"}), unsubscribeFromEvent);

server.post("/test", bodyparser.json({type: "*/*"}), async (req, res) => {
	//test endpoint for sending notifications
	if (req.body.pass !== process.env.PASS) {
		res.status(404).send("Cannot POST /test");
		return;
	}
	console.log("!!!debug send called for ", req.body.id);
	const resp = msg.send({
		notification: {
			title:"Test",
			body:"Test message"
		},
		token: req.body.id
	});
	res.status(200).json(resp);
}

server.listen(port, () => {
	console.log(`Notifications server started on port ${port}`);
});
