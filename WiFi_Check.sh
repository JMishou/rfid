#!/bin/bash
##################################################################
# A Project of TNET Services, Inc
#
# Title:     WiFi_Check
# Author:    Kevin Reed (Dweeber)
#            dweeber.dweebs@gmail.com
# Project:   Raspberry Pi Stuff
#
# Copyright: Copyright (c) 2012 Kevin Reed <kreed@tnet.com>
#            https://github.com/dweeber/WiFi_Check
#
# Purpose:
#
# Script checks to see if WiFi has a network IP and if not
# restart WiFi
#
# Uses a lock file which prevents the script from running more
# than one at a time.  If lockfile is old, it removes it
#
# Instructions:
#
# o Install where you want to run it from like /usr/local/bin
# o chmod 0755 /usr/local/bin/WiFi_Check
# o Add to crontab
#
# Run Every 5 mins - Seems like ever min is over kill unless
# this is a very common problem.  If once a min change */5 to *
# once every 2 mins */5 to */2 ... 
#
# */5 * * * * /usr/local/bin/WiFi_Check 
#
##################################################################
# Settings
# Where and what you want to call the Lockfile
lockfile='/var/run/WiFi_Check.pid'
# Which Interface do you want to check/fix
NET_ADAPTER='wlan0'
#DHCP_SERVER=`cat /var/lib/dhcp/dhclient.leases | grep dhcp-server | uniq | cut -d" " -f5 | cut -d";" -f1`
DHCP_SERVER=`cat /var/lib/dhcp/dhclient.wlan0.leases | grep dhcp-server | uniq | cut -d" " -f5 | cut -d";" -f1`
#DHCP_SERVER=`cat /var/lib/NetworkManager/dhclient-a66fab37-2f1a-45c0-8208-3d386cc56ba8-wlan0.lease | grep dhcp-server | uniq | cut -d" " -f5 | cut -d";" -f1`
#DHCP_SERVER=`cat /var/lib/NetworkManager/dhclient-d3c77744-a740-4d7a-bb70-fa2c6a9eaae2-wlan1.lease | grep dhcp-server | uniq | cut -d" " -f5 | cut -d";" -f1`
WIFI_STATUS_FILE=/home/pi/rfid/WiFi_status.json
WIFI_RECONNECT_ATTEMPTS=`cat $WIFI_STATUS_FILE | grep -Po '"reconnectAttempts":"\K[0-9]'`
ONLINE=0
REBOOT_REQUIRED=0
##################################################################

EXIT_STAT=0
# Check to see if there is a lock file
if [ -e $lockfile ]; then
    # A lockfile exists... Lets check to see if it is still valid
    pid=`cat $lockfile`
    if kill -0 &>1 > /dev/null $pid; then
        # Still Valid... lets let it be...
        echo "Process still running, Lockfile valid"
        exit 1
    else
        # Old Lockfile, Remove it
        #echo "Old lockfile, Removing Lockfile"
        rm $lockfile
    fi
fi
# If we get here, set a lock file using our current PID#
#echo "Setting Lockfile"
echo $$ > $lockfile

# We can perform check
PING_DHCP=`ping -c 1 $DHCP_SERVER`
rc=$?
if [ $rc -eq 0 ]; then
    ONLINE=1
    WIFI_RECONNECT_ATTEMPTS=0
else
    echo
    echo
    date
    echo
    echo "DHCP SERVER $DHCP_SERVER"
    echo $PING_DHCP
    #echo "$wlan down"
    /sbin/ifdown --force $NET_ADAPTER
    #echo "sleep 5"
    sleep 5
    #echo "$wlan up"
    /sbin/ifup $NET_ADAPTER
    #service network-manager restart
    #sleep 5
    PING_DHCP=`ping -c 1 $DHCP_SERVER`
    rc=$?
    if [ $rc -eq 0 ]; then
	ONLINE=1
	WIFI_RECONNECT_ATTEMPTS=0
    else
	ONLINE=0
	EXIT_STAT=2
	let "WIFI_RECONNECT_ATTEMPTS++"
	if [ "$WIFI_RECONNECT_ATTEMPTS" -ge "5" ]; then
		REBOOT_REQUIRED=1
	fi
    fi
fi

echo -e "{\"connected\":\""$ONLINE"\", \"reconnectAttempts\":\""$WIFI_RECONNECT_ATTEMPTS"\", \"restartRequired\":\""$REBOOT_REQUIRED"\", \"lastCheck\":\""$(date)"\"}" > $WIFI_STATUS_FILE
# Check is complete, Remove Lock file and exit
#echo "process is complete, removing lockfile"
if [ $REBOOT_REQUIRED -eq 1 ]; then
	WIFI_RECONNECT_ATTEMPTS=0
	echo -e "{\"connected\":\""$ONLINE"\", \"reconnectAttempts\":\""$WIFI_RECONNECT_ATTEMPTS"\", \"restartRequired\":\""$REBOOT_REQUIRED"\", \"lastCheck\":\""$(date)"\"}" > $WIFI_STATUS_FILE
	sleep 15
	/sbin/shutdown -r now
fi
rm $lockfile
exit $EXIT_STAT

##################################################################
# End of Script
##################################################################
