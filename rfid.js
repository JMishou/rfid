var http = require("http");
var https = require("https");
var os = require("os");
var querystring = require("querystring");
var hostname = os.hostname();
var Gpio = require('pigpio').Gpio;
var fs = require('fs');
var SerialPort = require("serialport");
var sprintf = require("sprintf-js").sprintf;
var async = require("async");
var mqtt = require('mqtt')
var fork = require('child_process').fork;





/*
var i2c = require('i2c-bus');
var i2cBus = i2c.open(1, function (err) {  if (err) throw err; });
var oled = require('oled-i2c-bus');

//var oled = require('oled-js-pi');
var font = require('oled-font-5x7');
*/

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
const CONFIG_FILE = "/config.json";
const LOCAL_PERMISSION_FILE = "/accessRFID.json";
const LOCAL_LOG_FILE = "/log.log";
const WORKING_DIRECTORY = "/home/pi/rfid";

var oledHandler = fork(WORKING_DIRECTORY + '/oled-handler.js');
var mqtt_client  = mqtt.connect('mqtt://headcheese')

const RELAY_PIN = 22;
const BUZZER_PIN = 17;

var dataState = 0;

var buzzer =  null;
var relay  =  null;

var RFIDData;
var oledCnt = 0;
var oledBusy = 0;

// accessMode: 0 normal operation , 1 open any, 2 admin only, 3 lock open, 4 lock out, 5 out of service
//var machineState = "{accessMode:'0'}";
var userID;
var accessGroup;

var serialport = new SerialPort('/dev/serial0', {
  parser: SerialPort.parsers.byteDelimiter([03])
});


var lastRFIDTime = 0;
var RFIDLoadInterval;

var url = 'https://txrxlabs.org/rfid_access.json?%s=%s&api_key=%s';
var configs;

var serdata = [];

oledHandler.on('message', function(response) {
  console.log(response);
});

//Main code


//loadState();
loadConfig(configsLoaded); //load configurations and then run configsLoaded()
setupGPIO();  //setup the GPIO pins
updateScreen();
var oledInterval = setInterval(updateScreen, 2000);


serialport.on('open', function() { // open serial port
    logData('Serial Port Opened');
    serialport.on('data', function(data) { // on get data

        Array.prototype.push.apply(serdata, data); // push the serial data to an array

    if (serdata.slice(serdata.indexOf(0x02), serdata.length).length >= 14) { // if the array is now 14 characters long
		    userID = rfidValue(serdata);
            serialport.flush(function(err,results){});
	    	serdata = [];

		    var currRFIDTime = (new Date).getTime();
		    if ((currRFIDTime - lastRFIDTime) < 2000){
			      lastRFIDTime = currRFIDTime;
			      return;
		    }
		    lastRFIDTime = currRFIDTime;

		    userAction(userID);
        	
        }
    });
});

//Functions

function configsLoaded(data){
    if (data != null){
      configs = data["config"];
      logData("Configs Loaded");
      logData(sprintf("Current State: %s",configs["accessMode"]));
      loadRFIDServer();
      RFIDLoadInterval = setInterval(loadRFIDServer, 1000 * 60 * 5);
    }
}

function loadConfig(callback){
    readJSON(WORKING_DIRECTORY + CONFIG_FILE, callback);
}

function readJSON(fileName, callback){
	fs.access(fileName, fs.F_OK, function(err) {
	    if (!err) {
	        fs.readFile(fileName, function(err1, data) {
	        if (err1) {
	            logData('Read file error ' + fileName + " : " + err1.toString());
	            callback(null);
	        }
	        logData("Data Loaded from File: " + fileName);
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
    logData("Data written to File: " + fileName);
    });
}

//takes the raw serial rfid data and converts it to a user ID
function rfidValue(rawRFID) {
    var rfid = rawRFID.slice(rawRFID.indexOf(0x02) + 1, rawRFID.indexOf(0x02) + 13);
    var cardID = 0;
    var chxm = 0;
    var rfidstring = [];

    async.eachSeries(rfid,function(value, callback) {
        rfidstring = rfidstring.concat(String.fromCharCode(value));
        
	callback();
    }, function(err) {
	    if( err ) {
	      console.log(err);
	    } 
    	});


    var i = 0;
    async.whilst(
	function () { return i < rfidstring.length-2; },
	function (callback) {
		chxm = chxm ^ parseInt("0x" + rfidstring.slice(i,i+2).join(""));
		i += 2;
		callback();
	},
	function (err) {
		if (err){
			throw err;
		}
	}
    );

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
	buzzer =  new Gpio(BUZZER_PIN, {mode: Gpio.OUTPUT});
	relay  =  new Gpio(RELAY_PIN, {mode: Gpio.OUTPUT});
}

//front pads a number with zeros to a specific length
function pad(num, size) {
    var s = "000000000" + num;
    return s.substr(s.length-size);
}

//Saves rfid table to a local file
function saveRFIDState() {
    fs.writeFile(WORKING_DIRECTORY + LOCAL_PERMISSION_FILE, JSON.stringify(RFIDData),function(err, data) {
      if (err) {
            logData('Unable to write file: ' + err.toString());
            return;
      }
    logData("RFID Data Saved to File.");
    });
}

//Loads rfid data from a local file
function loadRFIDLocal() {
    fs.readFile(WORKING_DIRECTORY + LOCAL_PERMISSION_FILE, function(err, data) {
        if (err) {
            logData('No local RFID File Found contacting server: ' + err.toString());
            //RFIDLoadInterval = setInterval(loadRFIDServer, 30000);
            return;
        }
        RFIDData = JSON.parse(data);
        logData("RFID Data Loaded from File.");
        dataState = 1;
    });
}

//Loads rfid data from the server
//if successful the data is written locally
//otherwise loads data from the local file.
function loadRFIDServer() {
    var _url = sprintf(url,configs["type"],configs["id"],configs["api"]);
    https.get(_url, function (res) {
        var body = '';

        res.on('data', function(chunk) {
            body += chunk;
        });

        res.on('end', function() {
            if (isJSONString(body)){
                RFIDData = JSON.parse(body);
                logData("Recieved RFID Data from Server.");
                saveRFIDState();
                dataState = 1;
                //clearInterval(RFIDLoadInterval);
            }
            else{
                logData("Invalid JSON data: " + body);
            }
        });
    }).on('error', function(e) {
        logData("Error Retrieving RFID Data from Server: " + _url, e);
	      loadRFIDLocal();
        return;
    });
}


//Looks up a user group level based on the userID
function lookupaccessGroup(userID) {
    var ag = null;
	async.reduce(Object.keys(RFIDData["rfids"]),[] ,function(memo, item, callback) {
		var ret = memo;
		
		if (RFIDData["rfids"][item].indexOf(userID) != -1) {
                	ret.push(item);
            	}

		callback(null, ret);

		}, function(err, result) {
				// if any of the file processing produced an error, err would equal that error
				if( err ) {
					// One of the iterations produced an error.
					// All processing will now stop.
					console.log(err.toString());
				} else {
				    ag = result;
			}
	});
    if (ag.length == 0) ag.push(-1);
    return ag;
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
    var scheduleVerified = false;
    accessGroup.forEach(function(group){
	var sched = RFIDData["schedule"][group];
	if (typeof sched != 'undefined') {
		Object.keys(sched).forEach(function(item){
			if (item == day && sched[item][0] <= time && sched[item][1] >= time) scheduleVerified = true;
		});
	}
    });
    
    return scheduleVerified;
}


// returns true if it is a holiday and the user group is excluded
function isHoliday(accessGroup){
    var now = new Date().toJSON();
    var holidays = RFIDData["holidays"];
    holidayVerified = false;
    now = now.slice(0,10);
    if (typeof holidays != 'undefined') {    

	    accessGroup.forEach(function(group){
		var index = Object.keys(holidays).indexOf(now)
			if (index!=-1) {
			    if (holidays[now][0] != group) {
			        holidayVerified = true;
			    }
			}		
	    });
    }
    return holidayVerified;
}

function checkAccessState(accessGroup){  //returns true if accessMode is in a useable state
// accessMode: 0 normal operation , 1 open any, 2 admin only, 3 lock open, 4 lock out, 5 out of service

    var useable = 0;
    var reason = "";

    switch (parseInt(configs['accessMode'])) {

                case 0:
                case 1:
                case 3:
                         useable = 1;
                         break;
                case 2:
                         if (accessGroup.indexOf(ADMIN_GROUP) != -1){
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
  if (parseInt(configs['accessMode']) == 3){
	logData(sprintf("Access Granted - %s - Access Group: %s - User ID: %s", "Mode: Open Any",accessGroupString(accessGroup),userID));
	if (accessGroup == -1){
	oledWarning([
		    ['Badge not in system', 2000],
		    ['register at kiosk' , 2000]
		    ]);
	}
	accessGranted();
  }
  else if (accessGroup == -1){
	logData(sprintf("Badge not in system - Badge Number: %s",userID));
	accessDenied();
        oledWarning([
	    ['Access Denied', 2000],
            ['Badge not in system', 2000],
            ['register at kiosk' , 2000]
            ]);
  }
  else if (schedule && !holiday && accessState[0]){
	    logData(sprintf("Access Granted - Access Group: %s - User ID: %s", accessGroupString(accessGroup),userID));
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
	var str = "";
	accessGroup.forEach(function(group){
	console.log(group);
		switch (parseInt(group)) {

		        case 0:
				str += "Non-paying Member";
				break;
		        case 1:
				str += "TXRX Supporter";
				break;
			case 2:
				str += "Amigotron";
				break;
		        case 10:
				str += "Tinkerer";
				break;
		        case 21:
				str += "Hacker";
				break;
			case 23:
				str += "Maker";
				break;
			case 30:
				str += "Table Hacker";
				break;
			case 40:
				str += "Studio Resident";
				break;
			case 99999:
				str += "Staff";
				break;
		}
		if (str != ""){
			str += ", "
		}
	});	
	str = str.replace(/\, $/, '');
	return str;
}

//log user and date/time for each attempt with result
function logData(message){
    console.log(message); 
    fs.appendFile(WORKING_DIRECTORY + LOCAL_LOG_FILE, Date.now().toString() + '\t' + message + '\n',function(err, data) {
      if (err) { 
            console.log('Unable to write to ' + fileName + ": " + err.toString());
            return;
      }
    });
}
/*
function loadState(){
	readJSON(WORKING_DIRECTORY + LOCAL_STATE_FILE, function(data) {
		machineState = data;
	});
}

function saveState(){
	writeJSON(WORKING_DIRECTORY + LOCAL_STATE_FILE, machineState, function(bool) {
		if (bool) logData("Data written successfully to file");
		else logData("Failed to write data to file");
	});
}
*/
function accessGranted(){
    buzzer.digitalWrite(1);
    relay.digitalWrite(1);
    setTimeout(function() { buzzer.digitalWrite(0); }, 100);
    setTimeout(function() { relay.digitalWrite(0); }, 6000);
    oledMessage("Access Granted",false);
}

function accessDenied(){
    buzzer.digitalWrite(1);
    oledMessage("Access Denied",false);
    async.series([
        function(callback){
            setTimeout(function() { buzzer.digitalWrite(0); }, 100);
            callback(null,null);
        },
        function(callback){
            setTimeout(function() { buzzer.digitalWrite(1); }, 200);
            callback(null,null);
        },
        function(callback){
            setTimeout(function() { buzzer.digitalWrite(0); }, 300);
            callback(null,null);
        }
    ]);
}

function updateScreen(){
	if (!oledBusy){
        if (oledCnt) {
            oledHandler.send("Welcome to TX/RX");
            oledCnt = 0;
        }		
        else {
            oledHandler.send("Scan Badge Here");
            oledCnt = 1;
        }
    }
    
}

function oledMessage(msg, priority){
    if (!oledBusy || priority){
        oledHandler.send(msg);
    }

}

function oledWarning(warning){ //warning : [ ['message1', time1], ['message2', time2], ['message3', time3], ... ]
    //console.log(warning);
    pauseOled();
    var totalTime = 100;
    async.eachSeries(warning,
              function(value, callback){
                    var val = value;
                    setTimeout(function (){
                            oledMessage(val[0],true);
                    },totalTime);
                    totalTime += val[1];
                    callback();
              }
    );

    setTimeout(function() { resumeOled(); }, totalTime);
    
}

function pauseOled(){
    oledBusy = 1;
    clearInterval(oledInterval);
}

function resumeOled(){
    oledBusy = 0;
    oledInterval = setInterval(updateScreen, 2000);
}
