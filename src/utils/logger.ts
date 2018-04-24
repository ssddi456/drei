import * as fs from "fs";
import * as util from "util";


Error.stackTraceLimit = 1000;
Error.prototype.stackTraceLimit = 1000;

const DEBUG = true;

function getLogger() {
    const tempLogFile = 'D:/temp/test.log';
    const ret = {
        info(...args: any[]) {
            if (DEBUG) {
                const now = new Date();
                fs.appendFileSync(tempLogFile,
                    `[${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}] ${args.map(x => typeof x == 'string' ? x : util.inspect(x)).join(' ')}
`);
            }
        },
        clear() {
            if (DEBUG) {
                fs.unlinkSync(tempLogFile);
            }
        },
        trace(...args: any[]) {
            if (DEBUG) {
                ret.info(`${args.map(x => typeof x == 'string' ? x : util.inspect(x)).join(' ')}
${new Error().stack!.split('\n').slice(2).join('\n')}`);
            }
        },
        setup() {
            if (DEBUG) {
                console.log = logger.info;
                console.error = logger.trace;
            }
        },
        log(info: () => any[] | any) {
            if (DEBUG) {
                let logInfo = info();
                if (!Array.isArray(logInfo)) {
                    logInfo = [logInfo];
                }
                this.info(...logInfo);
            }
        }
    };
    return ret;
}

// make a log file here
export const logger = getLogger();


process.on('uncaughtException', function (e: Error) {
    logger.log(() => e);
});

console.log = logger.info;
console.error = logger.trace;
