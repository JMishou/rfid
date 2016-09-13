import serial
import sys
import time
from operator import xor
# UART
ID = ""
Zeichen = 0
Checksumme = 0
Tag = 0
# Flags
Startflag = "\x02"
Endflag = "\x03"
# Open UART (close first just to make sure)
UART = serial.Serial("/dev/ttyAMA0", 9600)
UART.close()
UART.open()
while True:
    # Reset vars
    Checksumme = 0
    Checksumme_Tag = 0
    ID = ""
    # Read chars
    Zeichen = UART.read()
    # Start of transmission signaled?
    if Zeichen == Startflag:
        # Build ID
        for Counter in range(13):
            Zeichen = UART.read()
            ID = ID + str(Zeichen)
        # Remove endflag from string
        ID = ID.replace(Endflag, "" )
        # Calc checksum
        for I in range(0, 9, 2):
            Checksumme = Checksumme ^ (((int(ID[I], 16)) << 4) + int(ID[I+1], 16))
        Checksumme = hex(Checksumme)
        # Find tag
        Tag = ((int(ID[1], 16)) << 8) + ((int(ID[2], 16)) << 4) + ((int(ID[3], 16)) << 0)
        Tag = hex(Tag)
        # Print data
        print "------------------------------------------"
        print "Data: ", ID
        print "Tag: ", Tag
        print "ID: ", ID[4:10], " - ", int(ID[4:10], 16)
        print "Checksum: ", Checksumme
        print "------------------------------------------"
