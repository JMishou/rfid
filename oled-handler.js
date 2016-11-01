var i2c = require('i2c-bus');
var i2cBus = i2c.openSync(1);
var oled = require('oled-i2c-bus');
var font = require('oled-font-5x7');
//var sleep = require('sleep');

var busy = 0;


var oledOpts = {
  width: 128,
  height: 64,
  address: 0x3C
};

var oled = new oled(i2cBus, oledOpts);

process.on('message', function(msg) {
    oledMessage(msg);
});



function oledMessage(msg){
    //console.log(msg);
    oled.clearDisplay(false);
    oled.setCursor(1, 1);
    oled.writeString(font, 2, msg, 1, true);
}



