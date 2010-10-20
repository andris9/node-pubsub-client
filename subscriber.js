var request = require("request"),
    querystring = require("querystring");

//expose
this.Subscriber = Subscriber;

function Subscriber(hub_url, callback_url){
    if(!hub_url)throw new Error("Please specify a hub url");
    if(!hub_url.match(/^https?:\/\//i))throw new Error("Hub URL is not valid");
    if(!callback_url)throw new Error("Please specify a callback url");
    
    this.hub_url = hub_url;
    this.callback_url = callback_url;
}

Subscriber.prototype.verify = "async";
Subscriber.prototype.verify_token = false;
Subscriber.prototype.lease_seconds = false;

Subscriber.prototype.subscribe = function(topic_url, callback){
    this.change_subscription("subscribe", topic_url, callback);
}

Subscriber.prototype.unsubscribe = function(topic_url, callback){
    this.change_subscription("unsubscribe", topic_url, callback);
}

Subscriber.prototype.change_subscription = function(mode, topic_url, callback){
    if(!topic_url)throw new Error("Please specify a topic url");
    if(!topic_url.match(/^https?:\/\//i))throw new Error("Topic URL is not valid");
    
    var post_data = {};
    post_data["hub.mode"] = mode;
    post_data["hub.callback"] = this.callback_url;
    post_data["hub.verify"] = this.verify;
    if(this.verify_token)
        post_data["hub.verify_token"] = this.verify_token;
    if(this.lease_seconds)
        post_data["hub.lease_seconds"] = this.lease_seconds;
    post_data["hub.topic"] = topic_url;
    
    
    var post_headers = {
        "user-agent": this.user_agent || "nodebot/0.1"
    }
    
    var post_body = querystring.stringify(post_data);
    
    request({uri:this.hub_url, method:"POST", body:post_body, headers: post_headers},
            (function (error, response, body) {
        if (!error && response.statusCode == 202 || response.statusCode == 204) {
            callback(null, response.statusCode);
        }else{
            callback("Error retrieving data from hub URL "+this.hub_url, null);
        }
        request = null;
    }).bind(this))
}