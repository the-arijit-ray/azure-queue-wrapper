function convertTimeIntervalToCron(value: number, unit: string) {
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

module.exports = {
    convertTimeIntervalToCron
}