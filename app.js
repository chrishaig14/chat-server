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

function handleLogin(client, m) {
    clientUserMap[client.id] = m;
    userClientMap[m] = client.id;
    console.log("USER LOGGED IN: ", m);
    console.log("LOGGED USERS:", userClientMap);
}

function handleAddContact(client, m) {
    db.collection("users").updateOne({user: clientUserMap[client.id]}, {$push: {contacts: m}});
}

function handleGetContacts(client, m) {
    db.collection("users").find({});
}

io.on("connection", function (client) {
    console.log("A USER CONNECTED!");
    client.on("message", (m) => handleMessage(client, m));
    client.on("new:user", (m) => handleSignup(client, m));
    client.on("add:contact", (m) => handleAddContact(client, m));
    client.on("login", (m) => handleLogin(client, m));
});

server.listen(3000);
