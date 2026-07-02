# Qwerty Learner Sync

一个移动端可用的 Qwerty Learner 风格练习应用，保留账号登录和跨设备进度同步。词库按需从原项目公开 CDN 加载，不把大词库复制进本仓库。

## 运行

```powershell
node server.js
```

默认地址：

- 电脑本机：`http://localhost:4175`
- 手机访问：使用启动日志里的局域网地址，例如 `http://192.168.1.8:4175`

手机和电脑访问同一个服务地址后，注册同一个账号即可共享进度。

## 词库和来源

- 词库元信息：`public/src/dictionaries.json`
- 词库数据来源：`RealKai42/qwerty-learner`
- 原项目地址：`https://github.com/RealKai42/qwerty-learner`
- 原项目许可：GPL-3.0

本项目没有复制原站的大词库 JSON 文件，运行时按当前选择从 jsDelivr 拉取对应词库。

## 已实现

- 接近 Qwerty Learner 的主练习排版
- 原项目英文/代码类词库按需加载
- 章节切换
- 手机真实输入框和屏幕 QWERTY 键盘
- 注册、登录、退出
- 服务端进度保存和跨设备同步
- JSON 导入和导出

## 部署说明

GitHub 仓库可以保存源码；GitHub Pages 只能托管静态前端，不能运行 `server.js`，因此不能单独提供登录同步。要公网同步，需要把 Node 服务部署到 Render、Railway、Fly.io、VPS 或改接 Supabase/Firebase。
