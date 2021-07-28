# dokku config:set axle-web CUSTOM_DOMAIN=axle-web.openlab.ncl.ac.uk
# https://openlab.ncl.ac.uk/dokku/axle-web/
FROM nginx:alpine
MAINTAINER Dan Jackson
COPY default.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
