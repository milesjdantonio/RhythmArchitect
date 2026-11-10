package main;

public class Queue<T>
{
    private Node<T> firstNode;
    private Node<T> lastNode;
    private int size;

    public Queue()
    {
        firstNode = null;
        lastNode = null;
        size = 0;
    }

    public void enqueue(Node<T> item)
    {
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

    public void enqueue(T data)
    {
        enqueue(new Node<T>(data));
    }

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

    public void clear()
    {
        size = 0;
        firstNode = null;
        lastNode = null;
    }

    public boolean isEmpty()
    {
        return size == 0;
    }

    public int getSize()
    {
        return size;
    }

    public T peek()
    {
        if(isEmpty())
        {
            throw new EmptyQueueException();
        }
        return firstNode.getData();
    }
}
