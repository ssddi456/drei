import * as ts from 'typescript';

import { logger } from "../../utils/logger";
import { isSanInterpolation, getInterpolationOriginName, isSanShadowTs, getShadowTsOriginName, parseSan, parseSanInterpolation } from './preprocess';

function isSanProject(path: string) {
    return path.endsWith('.san.ts') && !path.includes('node_modules');
}

export const sanSys: ts.System = {
    ...ts.sys,
    fileExists(path: string) {
        logger.log(() => ['fileExists -- ', path]);

        if (isSanProject(path)) {
            return ts.sys.fileExists(path.slice(0, -3));
        }
        if (isSanInterpolation(path)) {
            return ts.sys.fileExists(getInterpolationOriginName(path));
        }
        if (isSanShadowTs(path)) {
            return ts.sys.fileExists(getShadowTsOriginName(path));
        }
        return ts.sys.fileExists(path);
    },
    readFile(path: string, encoding: string) {
        if (isSanProject(path)) {
            const fileText = ts.sys.readFile(path.slice(0, -3), encoding);
            logger.log(() => ['parse san when readfile', path]);
            if (isSan(path)) {
                return fileText ? parseSan(fileText) : fileText;
            } else if (isSanInterpolation(path)) {
                // the part of  interpolation;
                return fileText ? parseSanInterpolation(fileText) : fileText;
            } else if (isSanShadowTs(path)) {
                return fileText ? parseSan(fileText) : fileText;
            }
            return fileText;
        } else {
            const fileText = ts.sys.readFile(path, encoding);
            return fileText;
        }
    }
};

if (ts.sys.realpath) {
    const realpath = ts.sys.realpath;
    sanSys.realpath = function (path: string) {
        if (isSanProject(path)) {
            return realpath(path.slice(0, -3)) + '.ts';
        }
        return realpath(path);
    };
}
