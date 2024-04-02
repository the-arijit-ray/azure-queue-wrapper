# Azure Queue Wrapper for Node.js

A convenient wrapper to work with Azure Storage Queues in Node.js applications.

## Installation

You can install the package using npm:

```bash
npm install azure-queue-wrapper
```

## Usage

1. Initialize Azure Queue Wrapper
Import the package and initialize the Azure Queue Wrapper in your code:

```typescript
import { ProcessAzureQueueMessage, AddMessageToQueue } from 'azure-queue-wrapper';
```

2. Process Messages from Queue
Use the @ProcessAzureQueueMessage decorator to process messages from a queue based on a specified time interval:

```typescript
class MyQueueProcessor {
    @ProcessAzureQueueMessage('<connection-string>', { queue: '<queue-name>', retry: 3, timeInterval: [5, 'seconds'], deadLetterQueue: '<dead-letter-queue-name>', numberOfMessages: 1, isMessageEncoded: false, startupDelay: 60 }) // Replace with your connection string, queue name, retries count(default: 3), interval (default:5 seconds), deadLetterQueue name( default: <queue-name>-poison) , numberOfMessages(optional) default is 1, isMessageEncoded (optional) determines if messsage from queue will be encoded (default = false), startupDelay in seconds (optional) default is 60 seconds
    async processQueueMessage(message: any) {
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

3. Add Message to Queue
Use the @AddMessageToQueue decorator to add a message to a queue:

```typescript
class MyQueueProducer {
    @AddMessageToQueue('<connection-string>')
    async addMessageToQueue(queueName: string, message: any) {
        // Your message adding logic here
        return { status: 'success' };
    }
}

```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests on the GitHub repository.

## GitHub Repository

Find the source code, contribute, or report issues on [GitHub](https://github.com/the-arijit-ray/azure-queue-wrapper).


## License

This project is licensed under the MIT License.

