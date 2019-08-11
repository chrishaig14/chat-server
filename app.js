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

async function handleLogin(client, m) {
    clientUserMap[client.id] = m;
    userClientMap[m] = client.id;
    console.log("USER LOGGED IN: ", m);
    console.log("LOGGED USERS:", userClientMap);
    let result = await db.collection("users").findOne({user: m});
    console.log("LOGIN RESULT: ", result);
    if (result !== null) {
        client.emit("login:ok");
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

// async function handleAddContact(client, m) {
//     let thisUser = clientUserMap[client.id];
//
//
//     db.collection("users").updateOne({user: thisUser}, {$push: {contacts: m}});
//
//     let other = await db.collection("users").findOne({user: m});
//     console.log("OTHER:CONTACTS: ", other.contacts)
//     if (other.contacts.includes(thisUser)) {
//         let result = await db.collection("counters").findOne({type: "chats"});
//         let chatId = result.counter.toString();
//         await db.collection("chats").insertOne({
//             chatId: chatId,
//             type: "simple",
//             name: "",
//             users: [thisUser, m].sort(),
//             messages: []
//         });
//         db.collection("users").updateOne({user: thisUser}, {$push: {chats: chatId}});
//         db.collection("users").updateOne({user: m}, {$push: {chats: chatId}});
//
//         db.collection("counters").updateOne({type: "chats"}, {$set: {counter: result.counter + 1}});
//     }
//     // client.emit()
// }

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
    // let users = [...m.users, thisUser];
    m.users.push(thisUser);
    let chatId = await dbNewChat(m);
    for (let user of m.users) {
        console.log("ADDING CHAT TO USER: ", user);
        db.collection("users").updateOne({user: user}, {$push: {chats: chatId}});
    }
}

async function handleGetChat(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        let chatId = m;
        let result = await db.collection("chats").findOne({chatId: chatId}, {projection: {_id: 0}});
        // if (result == null) {
        //     result = {contact: contact, messages: []};
        // } else {
        //     result = {contact: contact, messages: result.messages};
        // }
        console.log("CHAT: ", result);
        client.emit("chat", result);
    } catch (err) {
        console.log("ERROR getting chat: ", err);
    }
}

async function handleGetAllChats(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        let result = await db.collection("users").findOne({user: thisUser}, {projection: {_id: 0, chats: 1}});
        console.log("RESULSSS:: ", result);
        result = await db.collection("chats").find({chatId: {$in: result.chats}}, {
            projection: {
                _id: 0,
                messages: 0
            }
        });
        console.log("aaaaaa:: ", result);
        let all = await result.toArray();
        // console.log("*****#####:: ", result);
        console.log("#####:: ", all);
        let chats = {};
        for (let a of all) {
            console.log("USERS: ", a);
            chats[a.chatId] = a;
        }
        console.log("ALL CHATS: ", chats);
        console.log("ALL CHATS: ", {chats: chats});
        client.emit("all:chats", {chats: chats});
    } catch (err) {
        console.log("ERROR getting chat: ", err);
    }
}

// async function handleGetContacts(client, m) {
//     try {
//         let result = await db.collection("users").findOne({user: clientUserMap[client.id]}, {
//             projection: {
//                 _id: 0,
//                 contacts: 1
//             }
//         });
//         console.log("GET CONTACTS RESULTS: ", result);
//         client.emit("contacts", result);
//     } catch (err) {
//         console.log("ERROR GETTING CONTACTS: ", err);
//     }
// }

async function handleSendMessage(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        console.log("RECEIVED MESSAGE: ", m);
        let chatId = m.payload.chatId;
        let message = {user: thisUser, content: m.payload.content};
        // let array = [thisUser, contact];
        // console.log("BEFORE SORTED: ", array);
        // array.sort();
        // console.log("SORTED: ", array);
        // let res = await db.collection("chats").findOne({});
        // if (res === null) {
        //     console.log("no previous messages between this two users:", array);
        //     let d = await db.collection("chats").insertOne({chatId: chatId, messages: []});
        // }
        console.log("CHAT ID: ", chatId);
        let result = await db.collection("chats").updateOne({chatId: chatId}, {$push: {messages: message}});
        console.log("CHAT RECEIVED OK!");
        let users = await db.collection("chats").findOne({chatId: chatId}, {projection: {_id: 0, users: 1}});
        console.log("USERS IN CHAT: ", users);
        users = users.users.filter(user => user !== thisUser);
        console.log("CNNECTED USERS:", userClientMap);
        for (let user of users) {
            console.log("USER IS: ", user);
            if (userClientMap.hasOwnProperty(user)) {
                let socket = io.sockets.sockets[userClientMap[user]];
                console.log("SOCKET IS: ", socket);
                socket.emit("new:message", {chatId: chatId, message: message});
            }
        }
        setTimeout(() => client.emit("ack:message", m.sqn), 5000);
        // client.emit("ack:message",m.sqn)
        // if (result == null) {
        //     result = {user: contact, messages: []};
        // }
        // console.log("CHAT: ", result);
        // client.emit("chat", result);
    } catch (err) {
        console.log("ERROR receiving chat: ", err);
    }
}

io.on("connection", function (client) {
    console.log("A USER CONNECTED!");
    client.on("message", (m) => handleMessage(client, m));
    client.on("new:user", (m) => handleSignup(client, m));
    // client.on("add:contact", (m) => handleAddContact(client, m));
    // client.on("get:contacts", (m) => handleGetContacts(client, m));
    client.on("new:chat", (m) => handleNewChat(client, m));
    client.on("get:chat", (m) => handleGetChat(client, m));
    client.on("get:all:chats", (m) => handleGetAllChats(client, m));
    client.on("login", (m) => handleLogin(client, m));
    client.on("disconnect", (m) => handleDisconnect(client, m));
    client.on("send:message", (m) => handleSendMessage(client, m));
});

server.listen(3000);
