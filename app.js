const server = require("http").createServer();
const io = require("socket.io")(server);
const MongoClient = require("mongodb").MongoClient;
const assert = require("assert");

const url = "mongodb://localhost:27017";
const dbName = "chat";
let db;

MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {
    assert.equal(null, err);
    console.log("Connected successfully to server");

    db = client.db(dbName);
    // client.close();
});

function handleMessage(m) {
    console.log("MESSAGE received", m);
    db.collection("messages").insertOne({"message": m}).catch(err => {
        console.log("DATABASE ERROR: ", err);
    });
}

var clientUserMap = {};
var userClientMap = {};

function handleSignup(client, m) {
    console.log(m);
    console.log("M:", client.id);
    db.collection("users").insertOne({user: m, chats: []});
}

async function handleLogin(client, m, callback) {
    clientUserMap[client.id] = m;
    userClientMap[m] = client.id;
    console.log("USER LOGGED IN: ", m);
    console.log("LOGGED USERS:", userClientMap);
    let result = await db.collection("users").findOne({user: m});
    console.log("LOGIN RESULT: ", result);
    if (result !== null) {
        client.emit("login:ok");
        console.log("WILL CALL CALLBACK: ", callback);
        setTimeout(callback, 5000);
    } else {
        client.emit("login:error");
    }
}

function handleDisconnect(client, m) {

    console.log("USER ", clientUserMap[client.id], " DISCONNECTED");
    let username = clientUserMap[client.id];
    delete userClientMap[username];
    delete clientUserMap[client.id];
}

async function dbNewChat(chat) {
    let result = await db.collection("counters").findOne({type: "chats"});
    let chatId = result.counter.toString();
    await db.collection("chats").insertOne({
        chatId: chatId,
        ...chat,
        messages: []
    });
    db.collection("counters").updateOne({type: "chats"}, {$set: {counter: result.counter + 1}});
    return chatId;
}

async function handleNewChat(client, m) {
    console.log("CREATING NEW CHAT: ", m);
    let thisUser = clientUserMap[client.id];
    m.users.push(thisUser);
    let chatId = await dbNewChat(m);
    for (let user of m.users) {
        db.collection("users").updateOne({user: user}, {$push: {chats: chatId}});
    }
}

async function handleGetChat(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        let chatId = m;
        let result = await db.collection("chats").findOne({chatId: chatId}, {projection: {_id: 0}});
        console.log("CHAT: ", result);
        client.emit("chat", result);
    } catch (err) {
        console.log("ERROR getting chat: ", err);
    }
}

async function handleGetAllChats(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        let chatIds = await db.collection("users").findOne({user: thisUser}, {projection: {_id: 0, chats: 1}});
        let chats = await db.collection("chats").find({chatId: {$in: chatIds.chats}});
        // let response = {chats: result.chats};
        // console.log("ALL CHATS RESPONSE: ", response);
        chats = await chats.toArray();
        let chatsObj = {};
        for (let chat of chats) {
            chatsObj[chat.chatId] = chat;
        }
        client.emit("all:chats", {chats: chatsObj});
    } catch (err) {
        console.log("ERROR getting chat: ", err);
    }
}

async function handleMarkAsRead(client, m) {
    console.log("MARKING AS READ: ", m);
    let thisUser = clientUserMap[client.id];
    let chat = await db.collection("chats").findOne({chatId: m.chatId});
    console.log("FOUND CHAT: ", chat);
    let messages = chat.messages;
    console.log("ALL MESSAGES: ", messages);
    let msgsRead = [];
    for (let msgId of m.messageIds) {
        for (let msg of messages) {
            if (msg.messageId === msgId) {
                msg.read.push(thisUser);
                msgsRead.push({messageId: msg.messageId, read: msg.read});
            }
        }
    }
    db.collection("chats").updateOne({chatId: m.chatId}, {$set: {messages: messages}});
    for (let user of chat.users) {
        if (userClientMap.hasOwnProperty(user)) {
            let userClient = io.sockets.sockets[userClientMap[user]];
            setTimeout(() => {
                console.log("SENDING ACK:READ TO ", user);
                userClient.emit("ack:read", {chatId: m.chatId, messagesRead: msgsRead});
            }, 0);
        }
    }
}

async function handleSendMessage(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        let chatId = m.payload.chatId;
        let message = {user: thisUser, content: m.payload.content};
        let counter = await db.collection("counters").findOne({type: "messages"});
        let messageId = counter.counter;
        db.collection("counters").updateOne({type: "messages"}, {$set: {counter: messageId + 1}});
        message = {...message, read: [thisUser], messageId};
        let result = await db.collection("chats").updateOne({chatId: chatId}, {$push: {messages: message}});
        let users = await db.collection("chats").findOne({chatId: chatId}, {projection: {_id: 0, users: 1}});
        users = users.users.filter(user => user !== thisUser);
        for (let user of users) {
            if (userClientMap.hasOwnProperty(user)) {
                let socket = io.sockets.sockets[userClientMap[user]];
                socket.emit("new:message", {chatId: chatId, message: message});
            }
        }
        setTimeout(() => client.emit("ack:message", {sqn: m.sqn, chatId, message}), 0);
    } catch (err) {
        console.log("ERROR receiving chat: ", err);
    }
}

async function handleSuggestUsers(client, m, callback) {
    let users = await db.collection("users").find({user: {$regex: "\^" + m}});
    users = await users.toArray();
    users = users.map(u => u.user);
    console.log("SUGGEST USERS: ", users);
    callback(users);
}

io.on("connection", function (client) {
    console.log("A USER CONNECTED!");
    client.on("message", (m) => handleMessage(client, m));
    client.on("new:user", (m) => handleSignup(client, m));
    client.on("new:chat", (m) => handleNewChat(client, m));
    client.on("get:chat", (m) => handleGetChat(client, m));
    client.on("get:all:chats", (m) => handleGetAllChats(client, m));
    client.on("login", (m, callback) => handleLogin(client, m, callback));
    client.on("disconnect", (m) => handleDisconnect(client, m));
    client.on("send:message", (m) => handleSendMessage(client, m));
    client.on("mark:read", (m) => handleMarkAsRead(client, m));
    client.on("suggest:users", (m, callback) => handleSuggestUsers(client, m, callback));
});

server.listen(3000);
