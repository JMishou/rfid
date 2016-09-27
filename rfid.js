//Libraries

var http = require("http");
var https = require("https");
var os = require("os");
var querystring = require("querystring");
var hostname = os.hostname();
var rpio = require('rpio');
var fs = require('fs');
var SerialPort = require("serialport");
var sprintf = require("sprintf-js").sprintf;


//Global variables

const ADMIN_GROUP = "99999";
const UNKNOWN_RFID_FMSG = "RFID number not known.";
const LOCKED_FMSG = "Access Control Unit Locked";
const ADMIN_ONLY_SMSG = "Access Control Admin Only Mode Accepted";
const ADMIN_ONLY_FMSG = "Admin Only Mode";
const ANY_ONLY_SMSG = "Any User Mode";
const NORMAL_SMSG = "Normal User Mode";
const NORMAL_FMSG = "Normal Mode User Schedule Invalid";
const DATA_STATE_UNLOADED = 0;
const DATA_STATE_LOADED = 1;
const CONFIG_FILE = "./config.json";
const LOCAL_PERMISSION_FILE = "./accessRFID.json";
const LOCAL_LOG_FILE = "./log";

var dataState = 0;

var accessVars = {
    accessMode: 0, // 0 normal operation , 1 open any, 2 admin only, 3 lock open, 4 lock out, 5 out of service
    quintescent: 0
};


var RFIDData;
var userID;
var accessGroup;

//var ReadLine = SerialPort.parsers.ReadLine;
var serialport = new SerialPort('/dev/serial0', {
  parser: SerialPort.parsers.byteDelimiter([03])
});


var lastRFIDTime = 0;
var RFIDLoadInterval;

var url = 'https://txrxlabs.org/rfid_access.json?%s=%s&api_key=%s';
var configs;
  /*
  }
  type: "door_id",
  id: "1",
  api: "hJVhmzCjYbXDV9Y6rjCRRrzWfERcyF"
  };
  */
var serdata = [];


//Main code
loadConfig(configsLoaded); //Figure out asynchonous calls for loading files.
setupGPIO();
//setTimeout(loadRFIDServer(),0); // load rfid data

serialport.on('open', function() { // open serial port
    console.log('Serial Port Opened'); 
    serialport.on('data', function(data) { // on get data
        Array.prototype.push.apply(serdata, data); // push the serial data to an array

    if (serdata.slice(serdata.indexOf(0x02), serdata.length).length >= 14) { // if the array is now 14 characters long
		    userID = rfidValue(serdata);
	    	serdata = [];
        
		    var currRFIDTime = (new Date).getTime();
		    if ((currRFIDTime - lastRFIDTime) < 2000){
			      lastRFIDTime = currRFIDTime;	
			      return;
		    }
		    lastRFIDTime = currRFIDTime;	
		    userAction(userID);
        serialport.flush(function(err,results){});	
        }
    });
});

//Functions

function configsLoaded(data){
    if (data != null){
      configs = data["config"];
      console.log(configs["config"]); 
      console.log("Configs Loaded");
      loadRFIDServer();
    }
}

function loadConfig(callback){
    console.log(CONFIG_FILE);
    readJSON(CONFIG_FILE, callback);
 
/*    
    fs.access(CONFIG_FILE, fs.F_OK, function(err) {
    if (!err) {
        console.log("File exists");
        fs.readFile(CONFIG_FILE, function(err1, data) {
        if (err1) {
            logData('Unable to open ' + CONFIG_FILE + " : " + err1.toString());
            return;
        }
        console.log("Data Loaded from File: " + CONFIG_FILE);
        configs = JSON.parse(data)["config"];
        console.log(configs);
        console.log(configs["type"]);
        });
    } else {
         logData('Unable to open ' + CONFIG_FILE + " : " + err.toString());
    }
});
*/
    
}

function readJSON(fileName, callback){
fs.access(fileName, fs.F_OK, function(err) {
    if (!err) {
        console.log("File exists");
        fs.readFile(fileName, function(err1, data) {
        if (err1) {
            logData('Unable to open ' + fileName + " : " + err1.toString());
            callback(null);
        }
        console.log("Data Loaded from File: " + fileName);
        callback(JSON.parse(data));
        });
    } else {
         logData('Unable to open ' + fileName + " : " + err.toString());
    }
});
    
}

//takes the raw serial rfid data and converts it to a user ID
function rfidValue(rawRFID) {
    //console.log(rawRFID);
    var rfid = rawRFID.slice(rawRFID.indexOf(0x02) + 1, rawRFID.indexOf(0x02) + 13);
    var cardID = 0;
    var chxm = 0;
    var rfidstring = [];

    rfid.forEach(function(value) {
        rfidstring = rfidstring.concat(String.fromCharCode(value));
    });
    
    for (i = 0; i < rfidstring.length-2; i+=2) {
        chxm = chxm ^ parseInt("0x" + rfidstring.slice(i,i+2).join(""));
    }
    //console.log(parseInt(chxm,16));
    rfid = rfidstring.join("");
    cardID = pad(parseInt("0x" + rfid.slice(4,10)),10); 
    if (chxm == parseInt("0x" + rfid.slice(10,13))){
        return cardID
    }
    else{
        logData("Invalid Checksum: " + chxm + " for ID: " + cardID);
    }
}


//setup gpio here
function setupGPIO(){
	rpio.open(11, rpio.OUTPUT, rpio.LOW);
}

//front pads a number with zeros to a specific length
function pad(num, size) {
    var s = "000000000" + num;
    return s.substr(s.length-size);
}

//Saves rfid table to a local file
function saveRFIDState() {
    fs.writeFile(LOCAL_PERMISSION_FILE, JSON.stringify(RFIDData),function(err, data) {
      if (err) {
            logData('Unable to write file: ' + err.toString());
            return;
      }
    console.log("RFID Data Saved to File.");
    });
}

//Loads rfid data from a local file
function loadRFIDLocal() {
    fs.readFile(LOCAL_PERMISSION_FILE, function(err, data) {
        if (err) {
            logData('No local RFID File Found contacting server: ' + err.toString());
            RFIDLoadInterval = setInterval(loadRFIDServer, 30000);
            return;
        }
        RFIDData = JSON.parse(data);
        console.log("RFID Data Loaded from File.");
        dataState = 1;
    });
}

//Loads rfid data from the server
//if successful the data is written locally
//otherwise loads data from the local file.
function loadRFIDServer() {
    console.log(sprintf(url,configs["type"],configs["id"],configs["api"]));
    https.get(sprintf(url,configs["type"],configs["id"],configs["api"]), function (res) {
        var body = '';

        res.on('data', function(chunk) {
            body += chunk;
        });

        res.on('end', function() {
            if (isJSONString(body)){
                RFIDData = JSON.parse(body);
                console.log("Recieved RFID Data from Server.");
                saveRFIDState();
                dataState = 1;
                clearInterval(RFIDLoadInterval);
            }
            else{
                logData("Invalid JSON data: " + body);
            }
        });
    }).on('error', function(e) {
        console.log("Error Retrieving RFID Data from Server: ", e);
	      loadRFIDLocal();
        return;
    });
}


//Looks up a user group level based on the userID
function lookupaccessGroup(userID) {
    var keys = [];
    for (var key in RFIDData["rfids"]) {
        if (RFIDData["rfids"].hasOwnProperty(key)) {
            if (RFIDData["rfids"][key].indexOf(userID) != -1) return key;
        }
    }
    return -1;
}

function isJSONString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

//Check user group level access vs the current schedule
function verifySchedule(accessGroup) {
    var now = new Date();
    var day = now.getDay();
    var time = (now.getHours()*100)+now.getMinutes();
    if (accessGroup == ADMIN_GROUP) return true;
    
    var sched = RFIDData["schedule"][accessGroup];
    if (typeof sched == 'undefined') return false;
    for (var key in sched) {
        if (sched.hasOwnProperty(key) && key==day) {
            if (sched[key][0]<=time && sched[key][1] >= time)  {
              return true;
            }
        }
    }
    return false;
}


// returns true if it is a holiday and the user group is excluded
function isHoliday(accessGroup){
    var now = new Date("2016", "11", "25").toJSON();
    var holidays = RFIDData["holidays"];
    
    now = now.slice(0,10);

    if (typeof holidays == 'undefined') return false;
    for (var key in holidays) {
        if (holidays.hasOwnProperty(key) && key==now) {
            if (holidays[key][0] == accessGroup) {
              return false;
            }
            else{
              return true;
            }
        }
    }
    return false;
} 

//Triggers the user action based on proper permissions
function userAction(userID){
	accessGroup = lookupaccessGroup(userID);
  if (verifySchedule(accessGroup) && !isHoliday(accessGroup)){
	    logData("Access Granted - UserID: " + userID + " Access Group: " + accessGroup);
	    // Trigger relay for 2 second
      triggerRelay(2);
	}
  else {
    logData("Access Denied - UserID: " + userID + " Access Group: " + accessGroup);
  }
}

//log user and date/time for each attempt with result
function logData(message){
    console.log(message);
}

function triggerRelay(onTime){
      console.log("Trigger Relay: " + onTime);
      rpio.write(11, rpio.HIGH);
      rpio.sleep(onTime);
      rpio.write(11, rpio.LOW);
}
