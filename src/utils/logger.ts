import * as fs from "fs";
import * as util from "util";


Error.stackTraceLimit = 1000;
Error.prototype.stackTraceLimit = 1000;

function getLogger(...args: any[]) {
    const tempLogFile = 'D:/temp/test.log';
    const ret = {
        info(...args: any[]) {
            const now = new Date();
            // return;
            fs.appendFileSync(tempLogFile,
                `[${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}] ${args.map(x => typeof x == 'string' ? x : util.inspect(x)).join(' ')}
`);

        },
        clear() {
            // return;
            fs.unlinkSync(tempLogFile)
        },
        trace(...args: any[]) {
            // return;
            ret.info(`${args.map(x => typeof x == 'string' ? x : util.inspect(x)).join(' ')}
${new Error().stack!.split('\n').slice(2).join('\n')}`);
        },
        setup () {
            console.log('set up console');
            return;
            console.log = logger.info;
            console.error = logger.trace;
        }
    };
    return ret;
}

// make a log file here
export const logger = getLogger();

console.log = logger.info;
console.error = logger.trace;
