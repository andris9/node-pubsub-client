var Subscriber = require("./subscriber").Subscriber,
    redis = require("redis"),
    http = require("http"),
    URL = require("url"),
    xml2js = require('xml2js'),
    crypto=require("crypto");

this.SubscriptionHandler = {
    
    verify_token: false,
    pubsub_receiver: false,
    port: false,
    client: redis.createClient(),
    expire_timer: null,
    post_callback: false,
    
    expire_delay: 500,

    init: function(pubsub_receiver, verify_token, db, port){
        
        this.verify_token = verify_token || false;
        this.pubsub_receiver = pubsub_receiver || false;
        this.db = db || 0;
        this.port = port || 10081;
        
        this.client.select(this.db, (function(){
            this.startServer();
        }).bind(this));
        
    },
    
    startServer: function(){
        
        this.server = http.createServer((function (request, response) {
            console.log("Connection opened");
            if(request.method == "POST")
                this.managePosting(request, response);
            else
                this.manageSubscription(request, response);
        }).bind(this));
        this.server.listen(this.port);
        
        console.log("Server listening on port " + this.port);
        this.updateExpireTimer();
    },
    
    addBlog: function(blog_data, callback){
        
        this.client.multi().
            sadd("blogs", blog_data.url).
            hmset("blog:"+sha1(blog_data.url), "title", blog_data.title, "rss",
                blog_data.rss, "url", blog_data.url, "pubsub", blog_data.pubsub).
            set("blog:"+sha1(blog_data.rss)+":rss",
                blog_data.url)[blog_data.pubsub.trim()?"zadd":"zrem"]("pubsub",0,
                    blog_data.rss).exec((function(err, response){
                        if(!err){
                            if(typeof callback == "function")
                                callback(true);
                            this.updateExpireTimer();
                        }else if(typeof callback == "function")
                            callback(false);
                    }).bind(this));
    },
    
    removeBlog: function(url, unsubscribe, callback){
        this.client.hmget("blog:"+sha1(url), "rss", "pubsub", "title", (function(err, result){
            if(result && result.length){
                feed = result[0].toString("utf-8");
                pubsub = result[1].toString("utf-8");
                title = result[2].toString("utf-8");
                
                if(unsubscribe){
                    
                }
                
                this.client.multi().
                    del("blog:"+sha1(url)).
                    del("blog:"+sha1(feed)+":rss").
                    srem("blogs", url).
                    zrem("pubsub", feed).
                    exec(function(){
                        if(typeof callback=="function")
                            callback({
                                title: title,
                                rss: feed,
                                url: url,
                                pubsub: pubsub
                            });
                    });
            }else if(typeof callback=="function")
                callback(false);
        }).bind(this));
    },
    
    subscribeToFeed: function(feed){
        var url, pubsub, subscriber;
        this.client.get("blog:"+sha1(feed.trim())+":rss", (function(err, result){
            if(result){
                url = result.toString("utf-8");
                this.subscribeToBlog(url);
            }else console.log("Feed not found");
        }).bind(this));
    },
    
    unsubscribeFromBlog: function(blog_data){
        var subscriber;
        
        if(!blog_data.rss || !blog_data.pubsub){
            console.log("Error! Invalid data");
            return;
        }
                
        console.log("Unsubscribing from "+blog_data.url+" at "+blog_data.pubsub);
                
        subscriber = new Subscriber(blog_data.pubsub, this.pubsub_receiver);
        subscriber.verify_token = this.verify_token;
        subscriber.unsubscribe(blog_data.rss, (function(err, data){
            if(!err){
                // remove from queue on error
                this.removeFromQueue(blog_data.url, blog_data.rss);
                this.updateExpireTimer();
                console.log("Unsubscribed from "+blog_data.url);
            }else
                console.log("Unsubscribe error for "+blog_data.url);
        }).bind(this));
   },
    
    subscribeToBlog: function(url){
        var subscriber;
        this.client.hmget("blog:"+sha1(url), "rss", "pubsub", (function(err, result){
            if(result && result.length){
                feed = result[0].toString("utf-8");
                pubsub = result[1].toString("utf-8");
                
                if(!feed || !pubsub){
                    console.log("Error! Invalid data for "+url);
                    return;
                }
                
                console.log("Subscribing to "+url+" at "+pubsub);
                
                subscriber = new Subscriber(pubsub, this.pubsub_receiver);
                subscriber.verify_token = this.verify_token;
                subscriber.subscribe(feed, (function(err, data){
                    if(err){
                        // remove from queue on error
                        console.log(err.message || err || "Error");
                        this.removeFromQueue(url, feed);
                        this.updateExpireTimer();
                    }else{
                        if(data==204){
                            // delay for 1 day, since the actual expire time is not known
                            var score = Math.floor(Date.now()/1000 + 3600*24);
                            this.updateScore(feed, score, this.updateExpireTimer.bind(this));
                        }else{
                            console.log("Subscription request for "+url+" sent!");
                        }
                    }
                    subscriber = null;
                }).bind(this));
            }else console.log("Pubsub not found");
         }).bind(this));
    },
    
    manageSubscription: function(request, response){
        var data = URL.parse(request.url, true), score,
            feed = data && data.query && data.query.hub && data.query.hub.topic;
        
        console.log("SUBSCRIPTION for "+(feed || "unknown?"));
        
        if(!feed || data.query.hub.verify_token != this.verify_token ||
                !data.query.hub.topic || !data.query.hub.lease_seconds ||
                !data.query.hub.challenge){
            
            response.writeHead(404, {'Content-Type': 'text/plain'});
            response.end("Invalid request");
            console.log("Invalid request");
            return;
        }
        
        score = Math.floor(Date.now()/100+parseInt(data.query.hub.lease_seconds,10));
        
        this.updateScore(feed, score, this.updateExpireTimer.bind(this));
    },
    
    updateScore: function(feed, score, callback){
        this.client.zadd("pubsub", score, feed, (function(err, result){
            if(err){
                console.log("DB error "+(err && err.message));
            }else{
                console.log("Subscribed successfully to "+feed);
            }
            callback();
        }).bind(this));
    },
    
    managePosting: function(request, response){

        console.log("Incoming post");
        var url_data = URL.parse(request.url, true),
            rss_data = "", parser;
        
        request.setEncoding("utf-8");
        request.on("data", function(data){
            rss_data += data;
        });
        
        var sm = request.headers["x-hub-signature"];
        
        request.on("end", (function(data){
            response.writeHead(200, {'Content-Type': 'text/plain'});
            response.end("OK");

            // TODO: Check if feed is OK and update blog settings (title)

            var parser = new xml2js.Parser();
            parser.addListener('end', (function(result) {
                if(typeof this.post_callback == "function"){
                    process.nextTick(this.post_callback.bind(this, result));
                }
            }).bind(this));
            parser.parseString(rss_data);
            
        }).bind(this));
    },
    
    removeFromQueue: function(url, feed){
        this.client.multi().zrem("pubsub", feed).
            hdel("blog:"+sha1(url),"pubsub").
            exec((function(err, result){
                if(!err){
                    console.log("Removed from queue "+url+", "+feed);                                    
                }else{
                    console.log("Multi error :S")
                }
            }).bind(this));
    },
    
    updateExpired: function(){
        var feed;
        this.client.zrangebyscore("pubsub", 0, Date.now()/1000, (function(err, result){
            console.log("Updating "+(result && result.length || 0)+" feeds");
            if(result && result.length){
                for(var i=0, len=result.length; i<len; i++){
                    feed = result[i].toString("utf-8");
                    if(feed)
                        this.subscribeToFeed(feed)
                    if(i>10)return; // force quit
                }
            } 
        }).bind(this));
    },
    
    updateExpireTimer: function(){
        clearTimeout(this.expire_timer)
        this.client.zrange("pubsub", 0, 0, "WITHSCORES", (function(err, result){
            if(result && result.length==2){
                var score = parseInt(result[1].toString("utf-8"), 10),
                    exptime = score*1000 - Date.now();
                if(exptime<0)exptime = this.expire_delay;
                this.expire_timer = setTimeout(this.updateExpired.bind(this), exptime);
                console.log("Set expire delay to "+(exptime/1000)+" s")
            }
        }).bind(this));
    }
}

function sha1(str){
    var hash = crypto.createHash('sha1');
    hash.update(str);
    return hash.digest("hex").toLowerCase();
}