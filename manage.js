var subscription = require("./subscription").SubscriptionHandler,
    sys = require("sys");


subscription.init("saladus", "http://pubsub.node.ee/post", 5);

subscription.post_callback = function(data){
    console.log("FORMATTED DATA");
    console.log(sys.inspect(data))
    data = null;
}