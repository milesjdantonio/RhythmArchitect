package main;

/**
 * Thrown when something is taken from an empty queue.
 */
public class EmptyQueueException extends RuntimeException
{
    public EmptyQueueException()
    {
        super("The queue is empty");
    }
}
