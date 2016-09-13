var serdata = [];
var SerialPort = require("serialport");
var serialport = new SerialPort("/dev/ttyAMA0", 9600);
var lastRFIDTime = 0;
serialport.on('open', function() {
    console.log('Serial Port Opened');
    serialport.on('data', function(data) {
        Array.prototype.push.apply(serdata, data);
	console.log(serdata);
        if (serdata.slice(serdata.indexOf(0x02), serdata.length).length >= 14) {
            testrfid = serdata.slice(serdata.indexOf(0x02) + 1, serdata.indexOf(0x02) + 13);
            console.log(String.fromCharCode(testrfid));
            serdata = [];
            var currRFIDTime = (new Date).getTime();
            if ((currRFIDTime - lastRFIDTime) < 2000) return;
            lastRFIDTime = currRFIDTime;
    
            var rfidstring = [];

            testrfid.forEach(function(value) {
                rfidstring = rfidstring.concat(String.fromCharCode(value));
            });
            testrfid = rfidstring.join("");

            console.log(testrfid);

            console.log(testrfid.slice(4,10));
            console.log(parseInt("0x" + testrfid.slice(4,10)));

/*
            if (dataState == DATA_STATE_UNLOADED) {
                blink(3);
                return;
            }
            var accessGroup = lookupRFID(testrfid)
            if (accessGroup == -1) {
                logfail(testrfid, UNKNOWN_RFID_FMSG);
                return;
            }
            switch (accessVars.accessMode) {
                case 4:
                    logfail(testrfid,  LOCKED_FMSG)
                    break;
                case 3:
                    break;
                case 2:
                    if (accessGroup == ADMIN_GROUP) activate(testrfid, accessGroup, ADMIN_ONLY_SMSG);
                    else logfail(testrfid, ADMIN_ONLY_FMSG)
                    break;
                case 1:
                    activate(testrfid, accessGroup, ANY_ONLY_SMSG);
                    break;
                case 0:
                    if (verifySchedule(accessGroup)) activate(testrfid, accessGroup, NORMAL_SMSG);
                    else logfail(testrfid, NORMAL_FMSG);
                    break;

                default:

            }
*/
        }
    });
});


