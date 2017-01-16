#! /usr/bin/env node

var fs = require('fs');
var exec = require('child_process').exec;
var file = '/home/pi/rfid/WiFi_status.json';
try {
	var obj = JSON.parse(fs.readFileSync(file, 'utf8'));
	obj.restartRequired = 1;
	console.log(JSON.stringify(obj));
	fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
	console.log("rebooting");
	setTimeout(function(){
		
		exec('/sbin/shutdown -r now',function(error, stdout, stderr){
			console.log(stdout);					
		});
	}, 15000);
}
catch (e){
	console.log(e);
}
