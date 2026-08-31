# 超有用的工具箱

微信公众号「超有用的林」配套的 H5 工具箱，包含 66 个实用在线工具，全部为单文件 HTML，无后端依赖，移动端适配。

**线上地址：https://lwl555.github.io/toolbox/**

## 技术特点
- 纯前端实现，单文件 HTML，无需服务器
- 移动端优先，响应式设计
- 统一设计语言：圆角 16px、渐变色头部、卡片式布局
- 全部工具真实可用：PDF 处理（pdf-lib）、Excel 转换（SheetJS）、批量重命名（JSZip）、二维码/条形码均为本地生成
- 完全免费，无广告，文件不离开设备

## 部署到 GitHub Pages

### 1. 创建 GitHub 仓库
```bash
# 在桌面的项目目录中初始化 git
cd "C:\Users\sxiao\Desktop\超有用的工具箱"
git init
git add .
git commit -m "初始提交：66个H5工具"
```

### 2. 推送到 GitHub
```bash
# 替换 YOUR_USERNAME 为你的 GitHub 用户名
git remote add origin https://github.com/YOUR_USERNAME/super-useful-toolbox.git
git branch -M main
git push -u origin main
```

### 3. 启用 GitHub Pages
1. 打开仓库页面：https://github.com/YOUR_USERNAME/super-useful-toolbox
2. 点击 **Settings** → **Pages**
3. Source 选择 **Deploy from a branch**
4. Branch 选择 **main**，文件夹选择 **/ (root)**
5. 点击 **Save**
6. 等待 1-2 分钟，访问：https://YOUR_USERNAME.github.io/super-useful-toolbox/

### 4. 自定义域名（可选）
如果有域名，可以在 Pages 设置中添加自定义域名，并配置 CNAME 记录。

## 部署到 Vercel（推荐，速度更快）

### 1. 安装 Vercel CLI
```bash
npm i -g vercel
```

### 2. 部署
```bash
cd "C:\Users\sxiao\Desktop\超有用的工具箱"
vercel
```

### 3. 生产环境部署
```bash
vercel --prod
```

## 部署到 Netlify

1. 访问 https://app.netlify.com
2. 直接拖拽 `超有用的工具箱` 文件夹到页面
3. 自动生成链接，可在设置中绑定域名

## 本地预览

直接双击 `index.html` 即可在浏览器中打开。

或者使用简易 HTTP 服务器：
```bash
cd "C:\Users\sxiao\Desktop\超有用的工具箱"
python -m http.server 8080
# 访问 http://localhost:8080
```

## 工具列表（66个）

### 图片处理（8个）
- 九宫格切图、证件照换底色、图片压缩、图片格式转换
- 图片裁剪、图片旋转、图片加水印、图片拼接

### 文本工具（7个）
- 字数统计、文字转图片、Markdown编辑器、JSON格式化
- 文本去重、文本排序、文字加密

### 开发工具（7个）
- 正则表达式测试、Base64编解码、URL编解码
- 颜色代码转换、进制转换、HTML预览、CSS格式化

### 计算器（8个）
- 个税计算器、房贷计算器、车贷计算器、BMI计算器
- 年龄计算器、日期计算器、单位换算、百分比计算器

### 生成器（8个）
- 二维码生成器、条形码生成器、密码生成器、UUID生成器
- 随机数生成器、Lorem生成器、渐变色生成器、阴影生成器

### 设计工具（5个）
- 配色方案生成器、取色器、圆角生成器、字体预览、图片滤镜

### 生活工具（7个）
- 番茄钟计时器、倒计时器、秒表、世界时钟
- 随机选择器、抛硬币、掷骰子

### 办公工具（6个）
- PDF合并、PDF拆分、PDF压缩、批量重命名
- Excel转换、文字转语音

### 学习工具（4个）
- 思维导图、流程图、记忆卡片、学习计时器

### 趣味工具（6个）
- 表情包生成器、头像生成器、签名生成器
- 艺术字生成器、像素画板、梗图生成器

## 文件结构
```
超有用的工具箱/
├── index.html          # 主页面（工具导航）
├── *.html              # 66个工具页面
├── 工具实用性验证报告.md  # 工具验证报告
├── 用户画像与需求分析.md  # 用户画像分析
└── README.md           # 本文件
```

## 微信公众号发布建议

每个工具可以单独发布一篇公众号文章：
1. 标题格式：`【实用工具】XXX - 超有用的林`
2. 正文介绍工具功能和使用场景
3. 放上工具链接（GitHub Pages 地址）
4. 可以做成系列，每天发布一个

## 注意事项
- 所有工具均为纯前端实现，数据不会上传到服务器
- PDF 处理、Excel 转换等通过 CDN 加载开源库（pdf-lib / SheetJS / JSZip）在浏览器本地完成
- 建议使用 HTTPS 部署，部分浏览器 API 需要安全上下文
- 移动端体验最佳，建议优先测试手机端效果

## 联系方式
- 微信公众号：超有用的林
- GitHub：https://github.com/YOUR_USERNAME/super-useful-toolbox