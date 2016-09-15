var http = require("http");
var https = require("https");
var os = require("os");
var querystring = require("querystring");
var hostname = os.hostname();



var RFIDData;
var userID;
var userLevel;
var SerialPort = require("serialport");
var serialport = new SerialPort("/dev/ttyAMA0", 9600);
var lastRFIDTime = 0;
var fs = require('fs');
var url = 'https://txrxlabs.org/rfid_access.json?door_id=1&api_key=hJVhmzCjYbXDV9Y6rjCRRrzWfERcyF';
var doorid = 1;
var serdata = [];


loadRFIDServer();

serialport.on('open', function() {
    console.log('Serial Port Opened');
    serialport.on('data', function(data) {

        Array.prototype.push.apply(serdata, data);
        if (serdata.slice(serdata.indexOf(0x02), serdata.length).length >= 14) {
		var currRFIDTime = (new Date).getTime();
		if ((currRFIDTime - lastRFIDTime) <500) return;
		lastRFIDTime = currRFIDTime;
            	userID = rfidValue(serdata);
	    	serdata = [];
		userLevel = lookupUserLevel(userID);
	    	console.log("User ID: " + userID + " User Level:" + userLevel);
        }
    });
});


function pad(num, size) {
    var s = "000000000" + num;
    return s.substr(s.length-size);
}

function saveRFIDState() {
    fs.writeFile('/tmp/accessRFID.json', JSON.stringify(RFIDData));
    console.log("RFID Data Saved to File.");
}

function loadRFID() {
    fs.readFile('accessRFID.json', function(err, data) {
        if (err) {
            console.log('No RFID File Found contacting server…');
            RFIDLoadInterval = setInterval(loadRFIDServer, 30000);
            return;
        }
        RFIDData = JSON.parse(data);
        console.log("RFID Data Loaded from File.");
        dataState = 1;
    });
}

function loadRFIDServer() {
    https.get(url, function(res) {
        var body = '';

        res.on('data', function(chunk) {
            body += chunk;
        });

        res.on('end', function() {
            RFIDData = JSON.parse(body);
            console.log("Recieved RFID Data from Server.");
            //saveRFIDState();
            dataState = 1;
        });
    }).on('error', function(e) {
        console.log("Error Retrieving RFID Data from Server: ", e);
        return;
    });

    //clearInterval(RFIDLoadInterval);
    console.log('Completed Loading RFID Data From Server');
}

function lookupUserLevel(userID) {
    //var num = "0008369167"
    var keys = [];
    for (var key in RFIDData["rfids"]) {
        if (RFIDData["rfids"].hasOwnProperty(key)) {
            if (RFIDData["rfids"][key].indexOf(userID) != -1) return key;
        }
    }
    return -1;
}


function rfidValue(rawRFID) {
    //console.log(rawRFID);

    var rfid = rawRFID.slice(rawRFID.indexOf(0x02) + 1, rawRFID.indexOf(0x02) + 13);

    var rfidstring = [];

    rfid.forEach(function(value) {
        rfidstring = rfidstring.concat(String.fromCharCode(value));
    });
    rfid = rfidstring.join("");
    rfid = pad(parseInt("0x" + rfid.slice(4,10)),10);  
    return rfid
}
