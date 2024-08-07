# Adapted from:
# https://www.digitalocean.com/community/tutorials/how-to-build-a-node-js-application-with-docker
# https://github.com/spo-iitk/ras-backend/blob/main/container/Dockerfile
# https://phoenixnap.com/kb/letsencrypt-docker

FROM node:20-bullseye

ARG NODE_PORT
ENV NODE_PORT=${NODE_PORT:-6001}
ARG REDIS_PORT
ENV REDIS_PORT=${REDIS_PORT:-11211}

RUN mkdir -p /gcnotif-server

WORKDIR /gcnotif-server

RUN apt-get update
RUN apt-get install -y vim nginx

# Configure nginx
RUN rm /etc/nginx/sites-enabled/default
RUN rm /etc/nginx/nginx.conf

# Fix ports
RUN sed  "s/NODE_PORT/${NODE_PORT}/" "s/REDIS_PORT/${REDIS_PORT}" -I backup ./nginx/default

RUN ln -s  ./nginx/nginx.conf /etc/nginx/nginx.conf
RUN ln -s  ./nginx/default /etc/nginx/sites-enabled/default

RUN mkdir -p /etc/letsencrypt/live/notifications.sntiitk.com

# Certs are secret
# RUN --mount=type=secret,id=ssl   cp nginx/certs/* /etc/letsencrypt/live/notifications.sntiitk.com
# RUN chmod 400 /etc/letsencrypt/live/notifications.sntiitk.com/*

# Run Certbot

COPY package*.json ./

RUN npm install

RUN service nginx start

# HTTP
EXPOSE 80
# HTTPS
EXPOSE 443

CMD [ "node", "index.js" ]