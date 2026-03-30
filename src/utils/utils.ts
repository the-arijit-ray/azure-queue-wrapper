/**
 * Converts a time interval value and unit into a cron expression.
 * @example
 * convertTimeIntervalToCron(5, 'minutes')
 * "*/
export function convertTimeIntervalToCron(value: number, unit: string) {
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


/**
* Decodes an encoded message payload and returns the processed message content.
* @example
* getProcessedMessage(message, true)
* "decoded message text" or parsed JSON object
* @param {any} message - Message object containing the messageText property.
* @param {boolean} isMessageEncoded - Indicates whether the message text is base64 encoded.
* @returns {any} The decoded and parsed message content, or the original message text.
**/
export function getProcessedMessage(message: any,isMessageEncoded:boolean): any{
    let finalMessage;
    if(isMessageEncoded) {
        const decodedMessage = Buffer.from(message.messageText, 'base64').toString('utf-8');
        try{
            finalMessage = JSON.parse(decodedMessage);
        } catch (e) {
            finalMessage = decodedMessage
        }
    } else {
        finalMessage = message.messageText;
    }
    return finalMessage;
}