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
var oled = require('oled-js-pi');
var font = require('oled-font-5x7');


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
const LOCAL_STATE_FILE = "./state.json"
const LOCAL_LOG_FILE = "./log";

const RELAY_PIN = 15;
const BUZZER_PIN = 11;

var dataState = 0;

var accessVars = {
    accessMode: 0,
    quintescent: 0
};


var RFIDData;
var oledCnt = 0;

// accessMode: 0 normal operation , 1 open any, 2 admin only, 3 lock open, 4 lock out, 5 out of service
var machineState = "{accessMode:'0'}";
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

var oledOpts = {
  width: 128,
  height: 64,
  address: 0x3C
};

var oled = new oled(oledOpts);


//Main code

loadState();
loadConfig(configsLoaded); //load configurations and then run configsLoaded()
setupGPIO();  //setup the GPIO pins
updateScreen();
var oledInterval = setInterval(updateScreen, 2000);
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
      console.log("Configs Loaded");
      console.log(configs);
      loadRFIDServer();
    }
}

function loadConfig(callback){
    readJSON(CONFIG_FILE, callback);
}

function readJSON(fileName, callback){
	fs.access(fileName, fs.F_OK, function(err) {
	    if (!err) {
	        fs.readFile(fileName, function(err1, data) {
	        if (err1) {
	            logData('Read file error ' + fileName + " : " + err1.toString());
	            callback(null);
	        }
	        console.log("Data Loaded from File: " + fileName);
	        callback(JSON.parse(data));
	        });
	    }
	    else {
	         logData('Unable to open ' + fileName + " : " + err.toString());
	    }
  });
}

function writeJSON(fileName, data, callback){
    fs.writeFile(fileName, JSON.stringify(data),function(err, data) {
      if (err) {
            logData('Unable to write to ' + fileName + ": " + err.toString());
            return;
      }
    console.log("Data written to File: " + fileName);
    });
}

//takes the raw serial rfid data and converts it to a user ID
function rfidValue(rawRFID) {
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
	rpio.open(RELAY_PIN, rpio.OUTPUT, rpio.LOW);
  rpio.open(BUZZER_PIN, rpio.OUTPUT, rpio.LOW);
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
    var _url = sprintf(url,configs["type"],configs["id"],configs["api"])
    https.get(_url, function (res) {
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
        console.log("Error Retrieving RFID Data from Server: " + _url, e);
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
    //if (accessGroup == ADMIN_GROUP) return true;

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
    var now = new Date().toJSON();
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

function checkAccessState(accessGroup){  //returns true if accessMode is in a useable state
// accessMode: 0 normal operation , 1 open any, 2 admin only, 3 lock open, 4 lock out, 5 out of service

    var useable = 0;
    var reason = "";

    switch (parseInt(machineState['accessMode'])) {

                case 0:
                case 1:
                case 3:
                         useable = 1;
                         break;
                case 2:
                         if (accessGroup == ADMIN_GROUP){
                             useable = 1;
                         }
                         else{
                             reason = " ADMIN ONLY";
                         }

                         break;
                case 4:
                         reason = " LOCKED OUT";
                         break;
                case 5:
                         reason = " OUT OF SERVICE";
                         break;
                default:
                         break;
            }

    return [useable,reason];

}

//Triggers the user action based on proper permissions
function userAction(userID){
  var accessGroup = lookupaccessGroup(userID);
  var holiday = isHoliday(accessGroup);
  var schedule = verifySchedule(accessGroup);
  var accessState = checkAccessState(accessGroup);
  var denyString = "Access Denied -";
  if (parseInt(machineState['accessMode']) == 3){
	logData(sprintf("Access Granted - %s - Access Group: %s - User ID: %s", "Mode: Open Any",accessGroupString(accessGroup),userID));
	accessGranted();
  }
  else if (schedule && !holiday && accessState[0]){
	    logData("Access Granted");
      	    accessGranted();
  }
  else{
      if(!accessState[0]) denyString += accessState[1];
      else if(holiday) denyString += "CLOSED FOR HOLIDAY"
      else if(!schedule) denyString += sprintf(" %s : OUTSIDE OF SCHEDULE",accessGroupString(accessGroup));


      logData(denyString);

      accessDenied();
  }
}

function accessGroupString(accessGroup){
	switch (parseInt(accessGroup)) {

                case 0:
			return "Non-paying Member";
                case 1:
			return "TXRX Supporter";
		case 2:
			return "Amigotron";
                case 10:
			return "Tinkerer";
                case 21:
			return "Hacker";
		case 23:
			return "Maker";
		case 30:
			return "Table Hacker";
		case 40:
			return "studio Resident";
                default:
			return "";
	}

}

//log user and date/time for each attempt with result
function logData(message){
    console.log(message);
}


function loadState(){
	readJSON(LOCAL_STATE_FILE, function(data) {
		machineState = data;
	});
}

function accessGranted(){
      rpio.write(BUZZER_PIN, rpio.HIGH);
      rpio.write(RELAY_PIN, rpio.HIGH);
      rpio.sleep(0.1);
      rpio.write(BUZZER_PIN, rpio.LOW);
      rpio.sleep(2);
      rpio.write(RELAY_PIN, rpio.LOW);
}

function accessDenied(){
      rpio.write(BUZZER_PIN, rpio.HIGH);
      rpio.sleep(0.1);
      rpio.write(BUZZER_PIN, rpio.LOW);
      rpio.sleep(0.1);
      rpio.write(BUZZER_PIN, rpio.HIGH);
      rpio.sleep(0.1);
      rpio.write(BUZZER_PIN, rpio.LOW);
}

function saveState(){
	writeJSON(LOCAL_STATE_FILE, machineState, function(bool) {
		if (bool) console.log("Data written successfully to file");
		else console.log("Failed to write data to file");
	});
}

function updateScreen(){
	oledCnt++;
	oled.clearDisplay();
	if (oledCnt%2) {
		oled.setCursor(1, 1);
		oled.writeString(font, 2, 'Welcome to TX/RX', 1, true);
	}		
	else {
		oled.setCursor(1, 1);
		oled.writeString(font, 2, 'Scan Badge Here', 1, true);
	}

}
