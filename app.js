const MongoClient = require("mongodb").MongoClient;
const assert = require("assert");

const url = "mongodb://localhost:27017";
const dbName = "chat";
let db;

const express = require("express");
const app = express();
const port = 8888;
app.use(express.json());
const cors = require("cors");
app.use(cors());
app.options("*", cors());

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

function handleSignup(request, response) {
    console.log("CREATING NEW USER: ", request.body);
    db.collection("users").insertOne({user: request.body.username, chats: []});
    response.writeHead(204);
    response.end();
}

app.post("/users", handleSignup);

async function handleLogin(request, response) {
    console.log("LOGIN : ", request.body);
    let result = await db.collection("users").findOne({user: request.body.username});
    console.log("LOGIN RESULT: ", result);

    if (result !== null) {
        response.writeHead(204);
    } else {
        response.writeHead(401);
    }
    response.end();
}

app.post("/login", handleLogin);

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

async function handleNewChat(request, response) {
    console.log("CREATING NEW CHAT: ", request.body);
    request.body.users.push(request.headers.authorization);
    let chatId = await dbNewChat(request.body);
    for (let user of request.body.users) {
        db.collection("users").updateOne({user: user}, {$push: {chats: chatId}});
    }
    response.writeHead(204);
    response.end();

}

app.post("/chats", handleNewChat);

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

async function handleGetAllChats(request, response) {
    try {
        // let thisUser = clientUserMap[client.id];
        let thisUser = request.headers["authorization"];
        console.log("GETTING CHATS FOR USER: ", thisUser);
        let chatIds = await db.collection("users").findOne({user: thisUser}, {projection: {_id: 0, chats: 1}});
        let chats = await db.collection("chats").find({chatId: {$in: chatIds.chats}});
        // let response = {chats: result.chats};
        // console.log("ALL CHATS RESPONSE: ", response);
        chats = await chats.toArray();
        let chatsObj = {};
        for (let chat of chats) {
            chatsObj[chat.chatId] = chat;
        }
        // callback({chats: chatsObj});
        // response.setHeader("Content-Type", "application/json");
        // response.writeHead(200);
        console.log("SENDING BACK: ", chatsObj);
        // response.write(JSON.stringify(chatsObj));
        // response.send(chatsObj);
        response.status(200);
        response.json(chatsObj);
        response.end();
    } catch (err) {
        // console.log("ERROR getting chat: ", err);
    }
}

app.get("/chats", handleGetAllChats);

// async function handleMarkAsRead(request, response) {
//     // console.log("MARKING AS READ: ", m);
//     let thisUser = request.headers["authorization"];
//     let chat = await db.collection("chats").findOne({chatId: request.params.chatId});
//     console.log("FOUND CHAT: ", chat);
//     let messages = chat.messages;
//     console.log("ALL MESSAGES: ", messages);
//     let msgsRead = [];
//     for (let msgId of m.messageIds) {
//         for (let msg of messages) {
//             if (msg.messageId === msgId) {
//                 msg.read.push(thisUser);
//                 msgsRead.push({messageId: msg.messageId, read: msg.read});
//             }
//         }
//     }
//     db.collection("chats").updateOne({chatId: m.chatId}, {$set: {messages: messages}});
//     for (let user of chat.users) {
//         if (userClientMap.hasOwnProperty(user)) {
//             let userClient = io.sockets.sockets[userClientMap[user]];
//             setTimeout(() => {
//                 console.log("SENDING ACK:READ TO ", user);
//                 userClient.emit("ack:read", {chatId: m.chatId, messagesRead: msgsRead});
//             }, 0);
//         }
//     }
// }
//
// app.put("/chats/:chatId/messages/:messageId/read", handleMarkAsRead);

async function handleSendMessage(request, response) {
    try {
        let thisUser = request.headers["authorization"];
        let chatId = request.params["chatId"];
        // let chatId = m.payload.chatId;
        console.log("SENGIND MSG: ", request.body);
        let message = {user: thisUser, content: request.body.message};
        let counter = await db.collection("counters").findOne({type: "messages"});
        let messageId = counter.counter;
        db.collection("counters").updateOne({type: "messages"}, {$set: {counter: messageId + 1}});
        message = {...message, read: [thisUser], messageId, timestamp: new Date()};
        let result = await db.collection("chats").updateOne({chatId: chatId}, {$push: {messages: message}});
        // let users = await db.collection("chats").findOne({chatId: chatId}, {projection: {_id: 0, users: 1}});
        // users = users.users.filter(user => user !== thisUser);
        // for (let user of users) {
        //     if (userClientMap.hasOwnProperty(user)) {
        //         let socket = io.sockets.sockets[userClientMap[user]];
        //         socket.emit("new:message", {chatId: chatId, message: message});
        //     }
        // }
        // setTimeout(() => client.emit("ack:message", {sqn: m.sqn, chatId, message}), 0);
        response.setHeader("Content-Type", "application/json");
        response.writeHead(200);
        console.log("SENDING MESSAGE: ", message);
        response.write(JSON.stringify(message));
        response.end();
    } catch (err) {
        console.log("ERROR receiving chat: ", err);
    }
}

app.post("/chats/:chatId/messages", handleSendMessage);

async function handleSuggestUsers(client, m, callback) {
    let users = await db.collection("users").find({user: {$regex: "\^" + m}});
    users = await users.toArray();
    users = users.map(u => u.user);
    console.log("SUGGEST USERS: ", users);
    callback(users);
}

// app.get("")

// io.on("connection", function (client) {
//     console.log("A USER CONNECTED!");
//     client.on("message", (m) => handleMessage(client, m));
//     client.on("new:user", (m) => handleSignup(client, m));
//     client.on("new:chat", (m) => handleNewChat(client, m));
//     client.on("get:chat", (m) => handleGetChat(client, m));
//     client.on("get:all:chats", (callback) => handleGetAllChats(client,callback));
//     client.on("login", (m, callback) => handleLogin(client, m, callback));
//     client.on("disconnect", (m) => handleDisconnect(client, m));
//     client.on("send:message", (m) => handleSendMessage(client, m));
//     client.on("mark:read", (m) => handleMarkAsRead(client, m));
//     client.on("suggest:users", (m, callback) => handleSuggestUsers(client, m, callback));
// });
//
// server.listen(3000);

app.listen(port);
