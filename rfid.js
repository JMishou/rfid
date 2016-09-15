var RFIDData;
var serdata = [];
var SerialPort = require("serialport");
var serialport = new SerialPort("/dev/ttyAMA0", 9600);
var lastRFIDTime = 0;


loadRFID();
serialport.on('open', function() {
    console.log('Serial Port Opened');
    serialport.on('data', function(data) {
        Array.prototype.push.apply(serdata, data);
        if (serdata.slice(serdata.indexOf(0x02), serdata.length).length >= 14) {
            testrfid = serdata.slice(serdata.indexOf(0x02) + 1, serdata.indexOf(0x02) + 13);
            serdata = [];
            var currRFIDTime = (new Date).getTime();
            if ((currRFIDTime - lastRFIDTime) < 2000) return;
            lastRFIDTime = currRFIDTime;
    
            var rfidstring = [];

            testrfid.forEach(function(value) {
                rfidstring = rfidstring.concat(String.fromCharCode(value));
            });
            testrfid = rfidstring.join("");
            testrfid = pad(parseInt("0x" + testrfid.slice(4,10)),10));  
            console.log(testrfid);
	    console.log(lookupRFID(testrfid));
        }
    });
});

function pad(num, size) {
    var s = "000000000" + num;
    return s.substr(s.length-size);
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

function lookupRFID(testrfid) {
    //var num = "0008369167"
    var keys = [];
    for (var key in RFIDData["rfid"]) {
        if (RFIDData["rfid"].hasOwnProperty(key)) {
            if (RFIDData["rfid"][key].indexOf(testrfid) != -1) return key;
        }
    }
    return -1;
}
