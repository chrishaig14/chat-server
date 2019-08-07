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
    db.collection("users").insertOne({user: m, contacts: []});
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

function handleAddContact(client, m) {
    db.collection("users").updateOne({user: clientUserMap[client.id]}, {$push: {contacts: m}});
}

async function handleGetChat(client, m) {
    try {
        let thisUser = clientUserMap[client.id];
        let contact = m;
        let array = [thisUser, contact];
        console.log("BEFORE SORTED: ", array);
        array.sort();
        console.log("SORTED: ", array);
        let result = await db.collection("chats").findOne({users: array});
        if (result == null) {
            result = {user: contact, messages: []};
        }
        console.log("CHAT: ", result);
        client.emit("chat", result);
    } catch (err) {
        console.log("ERROR getting chat: ", err);
    }
}

async function handleGetContacts(client, m) {
    try {
        let result = await db.collection("users").findOne({user: clientUserMap[client.id]}, {
            projection: {
                _id: 0,
                contacts: 1
            }
        });
        console.log("GET CONTACTS RESULTS: ", result);
        client.emit("contacts", result);
    } catch (err) {
        console.log("ERROR GETTING CONTACTS: ", err);
    }
}

io.on("connection", function (client) {
    console.log("A USER CONNECTED!");
    client.on("message", (m) => handleMessage(client, m));
    client.on("new:user", (m) => handleSignup(client, m));
    client.on("add:contact", (m) => handleAddContact(client, m));
    client.on("get:contacts", (m) => handleGetContacts(client, m));
    client.on("get:chat", (m) => handleGetChat(client, m));
    client.on("login", (m) => handleLogin(client, m));
    client.on("disconnect", (m) => handleDisconnect(client, m));
});

server.listen(3000);
