node-pubsub-client
==================

experimental PubSubHubbub client for node.js.

run with 

    node manage.js
    
to set up you need to create a script that adds blog data to the redis db

current script runs a http server on port 10081 to receive push notifications from the PubSubHubbub hubs. In the current configuration
the server is proxied by nginx webserver at address pubsub.node.ee -> localhost:10081 (that's the first param for subscriber.init())