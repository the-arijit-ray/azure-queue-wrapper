"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProcessedMessage = exports.convertTimeIntervalToCron = void 0;
function convertTimeIntervalToCron(value, unit) {
    let cronExpression = '';
    switch (unit.toLowerCase()) {
        case 'seconds':
            cronExpression = `*/${value} * * * * *`;
            break;
        case 'minutes':
            cronExpression = `*/${value} * * * *`;
            break;
        case 'hours':
            cronExpression = `0 */${value} * * *`;
            break;
        case 'days':
            cronExpression = `0 0 */${value} * *`;
            break;
        case 'weeks':
            cronExpression = `0 0 0 */${value * 7} *`;
            break;
        default:
            throw new Error(`Unsupported time interval unit: ${unit}`);
    }
    return cronExpression;
}
exports.convertTimeIntervalToCron = convertTimeIntervalToCron;
function getProcessedMessage(message, isMessageEncoded) {
    let finalMessage;
    if (isMessageEncoded) {
        const decodedMessage = Buffer.from(message.messageText, 'base64').toString('utf-8');
        try {
            finalMessage = JSON.parse(decodedMessage);
        }
        catch (e) {
            finalMessage = decodedMessage;
        }
    }
    else {
        finalMessage = message.messageText;
    }
    return finalMessage;
}
exports.getProcessedMessage = getProcessedMessage;
//# sourceMappingURL=utils.js.map