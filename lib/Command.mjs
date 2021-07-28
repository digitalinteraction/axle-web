//import { log } from './Utils.mjs';

export default class Command {
  constructor(config) {
    this.command = config.command;
    this.timeout = config.timeout;
    this.responsePrefix = Array.isArray(config.responsePrefix) ? config.responsePrefix.slice() : [config.responsePrefix];
  }

  async exec(device) {
    return await new Promise((resolve, reject) => {
      this.responses = [];
      this.lineHandler = (line) => {
//log('COMMAND-RX: ' + line);
        this.responses.push(line);
        let prefixFound = false;
        for (let responsePrefix of this.responsePrefix) {
          if (line.startsWith(responsePrefix)) {
            prefixFound = true;
          }
        }
        if (prefixFound) {
          clearTimeout(this.timerId);
          device.setLineHandler(this.oldLineHandler);
          resolve(this);
        }
      }
      this.oldLineHandler = device.setLineHandler(this.lineHandler);
      this.timerId = setTimeout(function() {
        device.setLineHandler(this.oldLineHandler);
        reject('ERROR: Command timeout: ' + this.command + ' ' + JSON.stringify(this.responses), this);
      }, this.timeout);
      device.writeLine(this.command);
    });
  }
}
