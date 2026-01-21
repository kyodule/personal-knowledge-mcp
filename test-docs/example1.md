# TypeScript 泛型指南

泛型是 TypeScript 中最强大的特性之一。它允许我们创建可重用的组件，同时保持类型安全。

## 基本语法

```typescript
function identity<T>(arg: T): T {
  return arg;
}
```

## 泛型约束

你可以使用 `extends` 关键字来约束泛型参数：

```typescript
interface Lengthwise {
  length: number;
}

function loggingIdentity<T extends Lengthwise>(arg: T): T {
  console.log(arg.length);
  return arg;
}
```

## 常见用例

1. 数组操作
2. Promise 封装
3. 工厂函数
4. React 组件 Props

## 最佳实践

- 尽量使用泛型而不是 `any`
- 为泛型参数使用描述性的名称
- 避免过度使用泛型
