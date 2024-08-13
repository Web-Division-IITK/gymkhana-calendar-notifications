# Gymkhana Calendar Notifications Server

A server that sends notifications to users according to events in the [Gymkhana Calendar](https://github.com/Web-Division-IITK/gymkhana-calendar-frontend/). This is necessary because PWAs unfortunately cannot reliably set timers locally, so the only remedy is to have a server keep track of time (and other details such as event cancellations and detail changes). Users can subscribe to a particular event to be notified:
 - when its details change
 - when it is cancelled
 - thirty minutes before it starts
 - and five minutes before it starts.

When a notification is due, the server uses Firebase Cloud Messaging to send the necessary notifications.

## Features

 - Written in Node.js
 - Uses redis to keep track of events and their subscribers
 - Dockerized for easy deployment
 
 # Notes
 
 - Set the environment variable `EMULATOR` for the `node` container to make the server use the local Firebase emulator suite running on the host system.
 