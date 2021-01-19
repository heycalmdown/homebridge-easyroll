import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
} from 'homebridge';
import * as request from 'superagent';

function posFlip(pos: number): number {
  return 100 - pos;
}

let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory('homebridge-easyroll', 'easyroll', EasyrollAccessory);
};

class EasyrollAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly name: string;
  private readonly ips: string[];
  private exampleStates = {
    On: true,
    Position: 100,
    TargetPosition: -1,
  };

  private intervalPosition: NodeJS.Timeout | null = null;

  private readonly informationService: Service;
  private readonly service: Service;
  private readonly buttons: Service[];

  constructor(log: Logging, config: AccessoryConfig) {
    this.log = log;
    this.name = config.name;
    this.ips = config.ip as string[];

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, 'INOSHADE')
      .setCharacteristic(hap.Characteristic.Model, 'Smart Blind')
      .setCharacteristic(hap.Characteristic.SerialNumber, `INOSHADE-${this.ips.join('+')}`);

    this.service = new hap.Service.WindowCovering(this.name);
    this.service.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.exampleStates.On = value as boolean;
        log.info('Set On', value);
        callback(null);
      })
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info('Got On', this.exampleStates.On);
        callback(null, this.exampleStates.On);
      });
    this.service.getCharacteristic(hap.Characteristic.CurrentPosition)
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicSetCallback) => {
        log.info('Got Position', this.exampleStates.Position);
        callback(null, this.exampleStates.Position);

        setTimeout(async () => {
          const currentPosition = await this.getEasyrollInfo();
          log.info('Update Position', this.exampleStates.Position);
          this.service.updateCharacteristic(hap.Characteristic.CurrentPosition, currentPosition);
        }, 0);
      });

    this.service.getCharacteristic(hap.Characteristic.TargetPosition)
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicSetCallback) => {
        if (this.exampleStates.TargetPosition < 0) {
          log.info('Got TargetPosition at just started');
          callback(null, this.exampleStates.Position); // random position

          setTimeout(async () => {
            const currentPosition = await this.getEasyrollInfo();
            this.exampleStates.TargetPosition = currentPosition;
            log.info('Update TargetPosition', this.exampleStates.TargetPosition);
            this.service.updateCharacteristic(hap.Characteristic.TargetPosition, this.exampleStates.TargetPosition);
          }, 0);
        } else {
          log.info('Got TargetPosition', this.exampleStates.TargetPosition);
          callback(null, this.exampleStates.TargetPosition);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info('Set TargetPosition', value);
        this.exampleStates.TargetPosition = value as number;
        callback(null);
    
        await this.setEasyrollPosition(this.exampleStates.TargetPosition);
    
        this.watchMoving(this.exampleStates.TargetPosition);
      });


    this.buttons = ['M1', 'M2', 'M3'].map(name => new hap.Service.Switch(name, name));
    this.buttons.forEach((b, i) => {
      b.getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.GET, cb => cb(null, false))
        .on(CharacteristicEventTypes.SET, async (input: CharacteristicValue, cb: CharacteristicSetCallback) => {
          log.info('Set ProgrammableSwitchEvent', input);
          cb(null);

          await this.sendEasyrollCommand('M' + (i + 1));
          setTimeout(() => {
            b.updateCharacteristic(hap.Characteristic.On, false);
          }, 1000);
          this.watchMoving();
        });
      this.service.addLinkedService(b);
    });

    log.info('Switch finished initializing!');
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log('Identify!');
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.service,
      ...this.buttons,
    ];
  }

  private async getEasyrollInfo(): Promise<number> {
    const res = await request.get(`http://${this.ips[0]}:20318/lstinfo`);
    const info = JSON.parse(res.text);
    info.position = posFlip(Math.floor(info.position));
    this.exampleStates.Position = info.position;
    return info.position;
  }

  private async setEasyrollPosition(target: number) {
    return Promise.all(this.ips.map(ip => {
      return request.post(`http://${ip}:20318/action`)
        .send({
          mode: 'level',
          command: posFlip(target),
        });
    })).then(res => res[0]);
  }

  private async sendEasyrollCommand(command: string) {
    return Promise.all(this.ips.map(ip => {
      return request.post(`http://${ip}:20318/action`)
        .send({
          mode: 'general',
          command: command,
        });
    })).then(res => res[0]);
  }

  private watchMoving(targetPosition = -1) {
    if (this.intervalPosition) {
      clearInterval(this.intervalPosition);
    }
    let prev = this.exampleStates.Position;
    this.intervalPosition = setInterval(async () => {
      const currentPosition = await this.getEasyrollInfo();
      this.log.info(`Moving ${prev} => ${currentPosition} => ${targetPosition}`);
      this.service.updateCharacteristic(hap.Characteristic.CurrentPosition, prev);
      this.service.updateCharacteristic(hap.Characteristic.TargetPosition, targetPosition >= 0 && targetPosition || currentPosition);

      this.exampleStates.Position = prev;
      this.exampleStates.TargetPosition = currentPosition;

      if (prev === currentPosition) {
        if (this.intervalPosition) {
          clearInterval(this.intervalPosition);
        }
      }
      prev = currentPosition;
    }, 1000);
  }
}
