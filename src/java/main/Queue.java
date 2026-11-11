package main;

/**
 * A first-in, first-out queue built on linked Nodes. A Song keeps one Queue of Notes per
 * difficulty, in the order the notes are played.
 *
 * @param <T> what the queue holds
 */
public class Queue<T>
{
    private Node<T> firstNode;
    private Node<T> lastNode;
    private int size;

    /**
     * Makes an empty queue.
     */
    public Queue()
    {
        firstNode = null;
        lastNode = null;
        size = 0;
    }

    /**
     * Adds a node to the back of the queue. A null node is ignored (nothing is added).
     *
     * @param item the node to add
     */
    public void enqueue(Node<T> item)
    {
        if(item == null)
        {
            return;
        }
        item.setNext(null);
        if(isEmpty())
        {
            firstNode = item;
        }
        else
        {
            lastNode.setNext(item);
        }
        lastNode = item;
        size++;
    }

    /**
     * Adds data to the back of the queue, in a new node.
     *
     * @param data the data to add (may be null)
     */
    public void enqueue(T data)
    {
        enqueue(new Node<>(data));
    }

    /**
     * Removes and returns the data at the front of the queue.
     *
     * @return the front data
     * @throws EmptyQueueException if the queue is empty
     */
    public T dequeue()
    {
        if(isEmpty())
        {
            throw new EmptyQueueException();
        }
        T data = firstNode.getData();
        firstNode = firstNode.getNext();
        size--;
        if(isEmpty())
        {
            lastNode = null;
        }
        return data;
    }

    /**
     * Removes everything from the queue (an empty queue stays empty).
     */
    public void clear()
    {
        size = 0;
        firstNode = null;
        lastNode = null;
    }

    /**
     * @return true when the queue holds nothing
     */
    public boolean isEmpty()
    {
        return size == 0;
    }

    /**
     * @return how many items the queue holds
     */
    public int getSize()
    {
        return size;
    }

    /**
     * Returns the data at the front of the queue without removing it.
     *
     * @return the front data
     * @throws EmptyQueueException if the queue is empty
     */
    public T peek()
    {
        if(isEmpty())
        {
            throw new EmptyQueueException();
        }
        return firstNode.getData();
    }
}
