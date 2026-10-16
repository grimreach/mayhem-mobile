# Mayhem iPad — separate project, deferred

Target: the owner's 13-inch M4 iPad, using direct USB to a HackRF.
This directory reserves the iPad project; no iPad app or driver is implemented yet.
Pi development lives in `../pi/` and does not require DriverKit or an Apple developer account.

Future first milestone: a development-signed iPadOS app and USBDriverKit extension
that reads the board identity and receives IQ. Prove this on hardware before porting
the interface. Development requires Xcode, a paid developer team, suitable provisioning,
and enabling the driver on the iPad. Distribution entitlements are a separate step.

Apple references:
- https://developer.apple.com/documentation/driverkit/creating-drivers-for-ipados
- https://developer.apple.com/forums/tags/usbdriverkit
