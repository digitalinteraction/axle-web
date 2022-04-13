# AxLE WebBluetooth

Live streaming data from AxLE devices (part of [Open Movement](https://openmovement.dev)).  This repo is moved from the old GitLab repo.

Website:

* https://digitalinteraction.github.io/axle-web/


## Technical Notes

### UART Service

* UART Service UUID: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
* TX Characteristic UUID: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
* RX Characteristic UUID: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

### Serve locally over HTTPS using a self-signed certificate

```bash
openssl req -newkey rsa:2048 -new -nodes -keyout key.pem -out csr.pem && openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out server.crt
http-server -S -K key.pem -C server.crt
```

<!--
### Dokku (configured for use on Open Lab internal servers)

```bash
#dokku config:set axle-web CUSTOM_DOMAIN=axle-web.openlab.ncl.ac.uk
git push dokku master
```

Web: (https://axle-web.openlab.ncl.ac.uk)[https://axle-web.openlab.ncl.ac.uk] or (https://openlab.ncl.ac.uk/dokku/axle-web/)[https://openlab.ncl.ac.uk/dokku/axle-web/]
-->


### Commands

```
Commands allowed when unauthenticated:
EXXXXXX: Erase all e.g. EXXXXXX (master password only)
XXXXXX = master password

UPPPPPP: Unlock e.g. UXXXXXX 
PPPPPP = password (defaults to master password)

PXXXXXX: Set the password
XXXXXX: New password if authenticated

Authenticated commands (following 'U' command):
E: Erase all device data
E?: Read Battery, Reset and Erase cycles - Format = B:xx,R:xx,E:xx\r\n
E!: Erase all, including cycle counts, restore defaults

0:
O: All hardware controls off. LEDs and motor off

1: Motor output test
2: LED2 output test, green
3: LED3 output test, blue
M: Motor pulse output

B or B?: Battery sample. Percent %
A or A?: Accelerometer sample. X, Y, Z, Orientation

T or T?: Read the device time
TXXXXXXXX: Set the time to X

H or H?: Read
HXXXXXXXX: Set
Set/read logging end time, hibernate start
  Response: H:XXXX

L: Request lower power slower connection
F: Request faster higher power connection
V or V?: Query connection interval. Response for 48ms is V:48
VXXXX: Set connection interval milliseconds

C or C?: Toggle or query cueing on for an hour or off
CXXXX: Set new cuing period to X* and turn on

NXXXX or N?: Set epoch period span with NXX*. 
  Default is 60 seconds. - Not fully tested

Y: Hardware control, empty battery using outputs - Not for normal use

WXXXX: Write download block number, responds as with 'Q' query
Q or Q?: Query command. 
  Response: time, T:
  active block,  B:
  active samples,  N:
  active epoch,  E:
  block count,  C:
  download block  I:
  
SXXXX: Sync epoch timing by offset X*. 
  Response: S:xxxx
  
R: Read command. 
  Response: Active block in ascii hex - A block is 510 bytes + Checksum (2 bytes)
  Data structure:
  typedef union Epoch_sample_tag  {
    uint16_t w[4];
    uint8_t b[8];
    struct {
      int8_t batt;
      int8_t temp;
      int8_t accel;
      int8_t steps;
      int8_t epoch[4];
    } part;
  } Epoch_sample_t;

  // Information tag in each block
  typedef struct EpochBlockInfo_tag {
    uint16_t block_number;
    uint16_t data_length;
    uint32_t time_stamp;  
  } EpochBlockInfo_t;

  // Epoch data block type
  typedef struct Epoch_block_tag {
    // Tag at start of each block - 8 bytes
    EpochBlockInfo_t info;  
    // Block data format
    uint16_t blockFormat;
    // Extended data area, implementation specific
    uint8_t meta_data[20]; 
    // 480 bytes of sequential epoch entries (1 hour/ 60 mins)
    Epoch_sample_t epoch_data[EPOCH_BLOCK_DATA_COUNT];
    // Checksum, ECC or CRC etc.
    uint16_t check;
  } Epoch_block_t;

I: IMU stream on/off
  Response: Streaming accel data - Raw ascii-hex data stream in format

          // Add streaming packet data header for time, batt, temp, count, etc... 
          timeStamp,   // 8 chars
          battRaw,  // 4 chars
          tempRaw,  // 4 chars
          accel_samples[25],  // 25 * 12 chars
          terminator,  // "\r\n", 2 chars
          
D: Debug
  Response: Debug values stream output - Experimental only
  
G: Goal function setup  - Not fully tested
  GOXXXX: Set goal period offset to X*
  GPXXXX: Set goal period value to X*
  GGXXXX: Set the goal threshold value to X*
  Response: O:X P:Y G:Z value output
  
X: Device reset - Used to reset to bootloader for firmware update
  X!: Reset now
  XD: Stop app, start bootloader
  XNNNN: Pause logger for N* seconds
  
* Value setting entered in ascii hex format. 
i.e. 266 = 256 + 10 = 0A01
```


