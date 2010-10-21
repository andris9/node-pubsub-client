var subscription = require("./subscription").SubscriptionHandler,
    sys = require("sys");

var verify_token = "saladus";

var counter = 0;

subscription.init("http://pubsub.node.ee/post", verify_token, 5);

subscription.post_callback = function(data){
    console.log("FORMATTED DATA");
    console.log(sys.inspect(data, false, 7));
    data = null;
    console.log(++counter + " "+ new Date());
}