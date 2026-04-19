def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def div(a, b):
    if b == 0:
        raise ValueError("Division by zero")
    return a / b


def calculate(a, operator, b):
    ops = {
        "+": add,
        "-": sub,
        "*": mul,
        "/": div,
    }
    if operator not in ops:
        raise ValueError(f"Invalid operator: {operator}")
    return ops[operator](a, b)


if __name__ == "__main__":
    tests = [
        (3, "+", 5, 8),
        (10, "-", 4, 6),
        (6, "*", 7, 42),
        (20, "/", 4, 5),
    ]
    for a, op, b, expected in tests:
        result = calculate(a, op, b)
        status = "OK" if result == expected else "FAIL"
        print(f"{status} {a} {op} {b} = {result} (expect {expected})")

    print("\nError handling:")
    try:
        calculate(1, "/", 0)
    except ValueError as e:
        print(f"OK Division by zero: {e}")
