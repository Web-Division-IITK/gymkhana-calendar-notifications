# Adapted from:
# https://www.digitalocean.com/community/tutorials/how-to-build-a-node-js-application-with-docker
# https://github.com/spo-iitk/ras-backend/blob/main/container/Dockerfile
# https://phoenixnap.com/kb/letsencrypt-docker

FROM node:20-bullseye

RUN mkdir -p /gcnotif-server

WORKDIR /gcnotif-server

RUN apt-get update

COPY package*.json ./

RUN npm install

EXPOSE 3000

CMD [ "node", "index.js" ]