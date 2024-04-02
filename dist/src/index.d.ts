declare const QueueOptions: any;
export declare function ProcessAzureQueueMessage(connectionString: string, options: typeof QueueOptions): (target: any, key: string) => void;
export declare function AddMessageToQueue(connectionString: string): (target: any, key: string, descriptor: PropertyDescriptor) => PropertyDescriptor | {
    status: string;
    error: any;
};
export {};
