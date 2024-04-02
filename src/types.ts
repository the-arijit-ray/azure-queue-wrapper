export interface QueueOptions {
    queue: string;
    timeInterval?: [number, string];
    maxRetries?: number;
    deadLetterQueue?: string;
    numberOfMessages?: number;
    isMessageEncoded?: boolean;
    startupDelay?: number;
}

export interface QueueTasks {
    queueName: string;
    cronExpression: string;
    callback: (message: any) => Promise<void>;
    maxRetries: number;
    deadLetterQueueName: string;
    numberOfMessages?: number;
    isMessageEncoded?: boolean;
}