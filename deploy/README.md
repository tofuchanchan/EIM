# EIM 生产部署手册

本手册供运维执行。首发使用一台 Linux 云服务器，同机部署 Caddy、Python 和 MySQL 8.4。业务库从空库初始化，微信通过公网 HTTPS 短链及二维码打开邀请函。

访问链路为 **微信 → HTTPS 443 → Caddy → Python → MySQL**。Caddy 管证书与续期。Python 读取正式域名生成 `/s/短码` 和二维码。MySQL 与 Python 通过专用容器网络通信，业务数据写入持久卷。[Compose 网络](https://docs.docker.com/compose/how-tos/networking/) · [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)

## 1. 交接资料和上线前检查

| 项目 | 交付和检查 |
|---|---|
| 源码版本 | 接收完整项目源码，记录本次发布对应的提交号或源码包校验值。部署入口是 `deploy/compose.yaml` 与 `deploy/compose.mysql.yaml`，Python 入口是 `production.py`。 |
| 域名 | 确定正式域名和 DNS 负责人。将 A 记录指向服务器公网 IPv4，确认 IPv6 已可用后再设置 AAAA。大陆接入按实际情况确认备案。当前配置以 Caddy 直接接收公网请求为前提，前面已有 CDN 或负载均衡时先由运维核对证书终止点、Host 和来源 IP 传递方式。 |
| 服务器 | 建议 Ubuntu 24.04 LTS x86_64、4 vCPU、8 GB 内存、约 100 GB SSD，公网出带宽 10 Mbps 起，集中群发可选 20 Mbps。需要 Docker Engine 与支持 `up --wait` 的 Compose v2，运行账号能管理容器、放通 TCP 80/443 并拉取镜像和 Python 依赖。 |
| 端口和磁盘 | 检查 80/443 是否已占用。云防火墙对公网放行 Caddy 的 TCP 80/443，SSH 按组织规则授权。确认 Docker 持久卷所在磁盘空间和备份落点。 |
| 密钥和验收 | 运维在服务器生成数据库凭据并创建首位管理员 `xuxinyi`。业务负责人指定试发活动和验收人，正式表单使用确认过的报名字段及个人信息告知文案。 |

源码交接使用项目文件和示例配置，正式密码在目标服务器或密钥管理器中创建。生产环境的 `deploy/.env`、`deploy/private/` 与数据库卷由运维保管。[Docker Engine 安装要求](https://docs.docker.com/engine/install/ubuntu/) · [工信部备案管理办法](https://wap.miit.gov.cn/zcfg/xxtxl/art/2024/art_7e48434c08c24131b4b7eecfca5b2b6c.html)

## 2. 设置部署参数

把源码放到约定目录，例如 `/srv/invite-studio`。以下命令均从项目根目录执行。同一个发布终端内使用 `studio` 函数，两个 Compose 文件按所示顺序使用。

```sh
cd /srv/invite-studio
studio() {
  docker compose --env-file deploy/.env \
    -f deploy/compose.yaml -f deploy/compose.mysql.yaml "$@"
}

docker version
docker compose version
command -v curl openssl
df -h
timedatectl show -p NTPSynchronized
sudo ss -ltnp '( sport = :80 or sport = :443 )'

umask 077
install -d -m 0700 deploy/private deploy/private/mysql-ca
test -e deploy/.env || cp deploy/.env.example deploy/.env
test -e deploy/private/mysql-root-password || openssl rand -hex 32 > deploy/private/mysql-root-password
test -s deploy/private/mysql-root-password
chmod 0400 deploy/private/mysql-root-password

# 在编辑器中将 INVITE_DOMAIN 替换成正式主机名
nano deploy/.env
studio config --quiet
```

`INVITE_DOMAIN` 只写主机名，例如 `invite.example.com`。默认数据库配置使用 `deploy/private/connection.json`，维护配置用 `deploy/private/maintenance.json`。空 CA 目录供 Compose 绑定挂载使用。root 密码文件在首次空卷启动前生成，并随已初始化的数据库卷对应保管。确认主机时钟同步，报名截止由服务器时间判断。

现有 Compose 的网关网段默认 `172.31.252.0/28`，Caddy 在该网段固定地址 `172.31.252.2`。如果和服务器、VPC 或现有 Docker 网络重叠，在 `deploy/.env` 中一起调整 `INVITE_PROXY_SUBNET` 和 `INVITE_PROXY_IP`。Python 只接受这个受信代理提交的客户端 IP。[Compose 文件合并说明](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)

## 3. 启动 MySQL 并建立专用账号

```sh
studio up -d --wait mysql
studio ps mysql
studio exec -e MYSQL_HISTFILE=/dev/null mysql mysql --protocol=SOCKET -uroot -p
```

在密码提示中输入 `deploy/private/mysql-root-password` 对应的值。MySQL 容器首次启动时建立 `invite_studio` 空库。在同一次交互式 SQL 会话运行以下命令，分别保存两条 `CREATE USER` 返回的随机密码。

```sql
CREATE USER 'invite_app'@'%' IDENTIFIED BY RANDOM PASSWORD;
CREATE USER 'invite_maint'@'%' IDENTIFIED BY RANDOM PASSWORD;

GRANT SELECT, INSERT, UPDATE, DELETE ON invite_studio.* TO 'invite_app'@'%';
GRANT SELECT, INSERT, UPDATE, CREATE, REFERENCES ON invite_studio.* TO 'invite_maint'@'%';
```

这两组账号通过应用和 MySQL 共用的私有网络访问数据库。root 通过 MySQL 容器本地连接使用。以上语句用于首次建账号，重试时先检查账号和凭据状态。运行账号授予读写权限，维护账号单独用于建表和升级。[MySQL CREATE USER](https://dev.mysql.com/doc/refman/8.4/en/create-user.html) · [MySQL GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html)

```sh
cp -n deploy/connection.mysql.example.json deploy/private/connection.json
cp -n deploy/connection.mysql.example.json deploy/private/maintenance.json
nano deploy/private/connection.json
nano deploy/private/maintenance.json
sudo chown root:10001 deploy/private/connection.json deploy/private/maintenance.json
sudo chmod 0440 deploy/private/connection.json deploy/private/maintenance.json
```

两份 JSON 的 `host` 均为 `mysql`，`port` 为 `3306`，`database` 为 `invite_studio`。运行文件填写 `invite_app`，维护文件填写 `invite_maint`，分别录入对应随机密码。密码中的引号和反斜杠按 JSON 转义。应用容器以 UID/GID 10001 运行，因此上面的配置文件给该组读权限，并由 Compose 只读挂载。

## 4. 初始化正式空库和首位管理员

```sh
studio build app
studio run --rm --no-deps \
  --volume "$PWD/deploy/private/maintenance.json:/run/invite-studio/maintenance/connection.json:ro" \
  app python tools/migrate_mysql.py \
  --config /run/invite-studio/maintenance/connection.json --empty-install --no-samples

studio run --rm --no-deps app python server.py user-add \
  --data-dir /run/invite-studio --username xuxinyi
```

初始化应输出 `"initialized": true`。首次且用户表为空时，创建管理员应输出 `Created admin account: xuxinyi`。运维在交互式终端为此账号单独设置生产密码，并通过安全渠道交接给账号本人。若回显创建的是普通成员，先核对目标库里已有的管理员与环境归属。`--no-samples` 初始化表结构而不导入演示活动，当前表结构版本为 **v4**。维护配置只挂载到这一回合的初始化命令。

## 5. 启动公网入口

```sh
studio up -d --wait
studio ps
studio logs --tail 100 app caddy mysql
```

MySQL 和应用健康后，Caddy 会为正式域名申请证书。用配置中的真实域名替换以下示例再运行。

```sh
origin=https://invite.example.com
curl -I "http://invite.example.com/"
curl -fsS "$origin/api/session"
studio exec -T app python -c "from urllib.request import urlopen; print(urlopen('http://127.0.0.1:8080/healthz', timeout=9).read().decode())"
```

期望 HTTP 跳到 HTTPS，公网 `/api/session` 返回 `storage=mysql`、`setupRequired=false`，容器内部健康检查返回 `{"ok":true}`。应用健康检查包含 MySQL 连通性与表结构版本。公网只走 Caddy，MySQL 3306 和 Python 8080 不在主机上映射。公网 `/healthz` 返回 404 属于当前网关配置。

## 6. 业务验收

- **后台登录**。以首位管理员 `xuxinyi` 通过正式域名登录。验证成员设密链接由正式域名生成，登录日志中的 IP 对应实际访问来源。
- **微信打开**。先发一场试发活动。iPhone 和安卓分别用移动网络从微信私聊或群聊点一次真正的 `/s/短码`，也用微信扫一扫二维码。短链与二维码应指向同一正式域名，邀请函能在微信内打开并正常翻页。
- **报名与状态**。在开放时段提交一条测试回执，后台按场次核对入库和回执。实测一组起止时间、关闭报名、恢复和下线。截止或手动关闭时邀请函仍可浏览，下线后原链接显示提示，已经收到的报名可在后台查询。
- **持久化**。在试发阶段重启应用容器后，确认原短链及报名仍能查询。试发验收完成后下线测试活动，交业务方发布正式活动。
- **记录证据**。记下部署版本、域名、MySQL 表结构版本、试发短链及真机验证结果。截图使用测试回执或对联系信息脱敏。

## 7. 备份、恢复和应用回退

MySQL 数据、Caddy 证书分别保存在 Compose 持久卷。把数据库备份纳入运维现有周期任务，备份保存到主机外的受控位置。在正式开收报名之前先演练从备份恢复。

同机 MySQL 的备份示例如下。秘密通过容器内的临时客户端配置读取，命令结束后删除该临时文件。

```sh
mysql_in_container() {
  studio exec -T mysql sh -c '
    set -eu
    umask 077
    options=$(mktemp)
    trap "rm -f \"$options\"" EXIT
    printf "[client]\nprotocol=socket\nuser=root\npassword=%s\n" \
      "$(cat /run/secrets/mysql_root_password)" > "$options"
    tool=$1
    shift
    "$tool" "--defaults-file=$options" "$@"
  ' mysql-client "$@"
}

install -d -m 0700 /srv/invite-studio-backups
backup="/srv/invite-studio-backups/invite_studio-$(date -u +%Y%m%dT%H%M%SZ).sql"
mysql_in_container mysqldump --single-transaction --quick --skip-lock-tables \
  --no-tablespaces --set-gtid-purged=OFF --skip-add-drop-table --hex-blob invite_studio \
  > "$backup.part" &&
test -s "$backup.part" &&
mv "$backup.part" "$backup"
```

检查命令退出码及最终 `.sql` 后，将备份转存到受控位置。在受控实例中使用**独立的空验证库**演练恢复，下面演示在同机 MySQL 新建一个仅供恢复验证的库。使用上一步成功生成的备份。

```sh
restore_db="invite_restore_$(date -u +%Y%m%d%H%M%S)"
mysql_in_container mysql -e "CREATE DATABASE $restore_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;" &&
mysql_in_container mysql "$restore_db" < "$backup" &&
mysql_in_container mysql "$restore_db" -e "
  SELECT schema_version FROM studio_meta WHERE singleton=1;
  SELECT COUNT(*) AS activities FROM events;
  SELECT COUNT(*) AS short_links FROM event_publications;
  SELECT COUNT(*) AS signups FROM registrations;"
```

核对恢复的结构版本与业务记录，演练库按组织测试数据流程处理。正式恢复前先保全备份之后新增的报名和日志，再按组织恢复流程切换数据库地址。[mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)

应用升级前保存当前镜像和备份。表结构兼容时，可只回退 Python 镜像。源代码、数据库和证书的持久卷继续使用当前部署的挂载。

```sh
# 升级前为正在运行的应用镜像保存回退标签
app_id=$(studio ps -q app)
app_image=$(docker inspect --format '{{.Image}}' "$app_id")
app_reference=$(docker inspect --format '{{.Config.Image}}' "$app_id")
docker tag "$app_image" invite-studio-app:rollback

# 记录 app_reference。需要回退且表结构兼容时沿用该值
docker tag invite-studio-app:rollback "$app_reference"
studio up -d --no-deps --no-build --force-recreate --wait app
studio ps app
```

如果已做了不兼容的表结构变更，先在独立库验证合适版本的备份和回退镜像，再切换正式连接。停机或重启使用 `studio stop`、`studio restart`，持久卷作为数据库和证书的存储位置保留。

## 8. 常见故障入口

| 现象 | 优先检查 |
|---|---|
| MySQL 一直不健康 | `studio logs --tail 100 mysql`，查看数据库卷、磁盘空间和初次初始化是否成功，核对开启服务所用的 Compose 文件。 |
| 空库初始化或首位管理员命令失败 | 检查连接 JSON、密码转义、同机主机名 `mysql`、两份配置的账号权限，以及应用容器 UID/GID 10001 能否读取挂载文件。旧库核对结构版本后使用维护升级流程。 |
| Caddy 一直等应用 | `studio ps` 和 `studio logs --tail 100 app`。检查 app 的 `/healthz` 与 MySQL 可达性，确认表结构已初始化。 |
| HTTPS 证书获取失败 | 核对域名解析是否指向这台主机，外网能否到 80/443，有无旧站点、未就绪的 AAAA 记录或上游代理占用。查看 `studio logs --tail 100 caddy`。 |
| 公网请求 403 或登录 IP 都相同 | 核对访问域名、`INVITE_DOMAIN`、Caddy 代理地址及是否在现有 CDN 或负载均衡之后。检查代理传递的是实际来源 IP 和正式 Host。 |
| 分享链接地址不对 | 核对 `deploy/.env` 的正式域名和应用实际运行配置。重新用正式域名打开工作台，复制短链并对照二维码。 |

## 9. 当前验证范围

本地已用 Waitress 和隔离 MySQL 验证生产入口的健康检查、登录、代理来源、短链和报名，空库初始化逻辑通过回归。同机 Compose、域名证书和微信真机属于目标服务器验收，按上面的步骤记录结果。
