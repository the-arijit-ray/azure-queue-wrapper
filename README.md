## Azure Queue Wrapper for Node.js
This package provides a convenient wrapper for working with Azure Storage Queues in Node.js applications.

### Installation
You can install the package using npm:

```bash
npm install azure-queue-wrapper
```
### Usage
1. Configure the Package
   First, create a configuration file named aqw.config.json in your project directory with the following content:
```json
{
"azureStorageConnectionString": "<your-azure-storage-connection-string>",
"retries": 3
} 
```
Replace <your-azure-storage-connection-string> with your actual Azure Storage connection string.

2. Initialize Azure Queue Wrapper
   Import the package and initialize the Azure Queue Wrapper in your code:

```javascript
const { ProcessAzureQueueMessage, AddMessageToQueue } = require('azure-queue-wrapper');
```
3. Process Messages from Queue
   Use the @ProcessAzureQueueMessage decorator to process messages from a queue based on a specified time interval:
```javascript
class MyQueueProcessor {
@ProcessAzureQueueMessage(connectionString,{ queue: 'my-queue', timeInterval: [5, 'seconds'], maxRetry: 3, deadLetterQueue: 'poison-queue-name' }) // Replace with your queue name, retries count(default: 3), interval (default:5 seconds) and deadLetterQueue name( default: <queue-name>-poison)
async processQueueMessage(message) { // Replace with your function name
// Your message processing logic here
}
}
```
### Supported Time Units

The following time units are supported for specifying the time interval:

- Seconds
- Minutes
- Hours
- Days
- Weeks

The time interval should be specified as a tuple with a numeric value and the unit, for example, `(5, 'seconds')` for 5 seconds, `(10, 'minutes')` for 10 minutes, and so on.
4. Add Message to Queue
   Use the @AddMessageToQueue decorator to add a message to a queue:

```javascript
class MyQueueProducer {
@AddMessageToQueue(connectionString)
async addMessageToQueue(queueName, message) { // Your function name
// Your message adding logic here
return { status: 'success' };
}
}
```
Contributing
Contributions are welcome! Please feel free to submit issues or pull requests on the GitHub repository.

## License
This project is licensed under the MIT License.

