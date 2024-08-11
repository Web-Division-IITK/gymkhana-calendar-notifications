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

RUN service nginx start