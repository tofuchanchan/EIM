FROM python:3.12.16-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt requirements-production.txt ./
RUN python -m pip install --no-cache-dir -r requirements-production.txt \
    && mkdir -p /run/invite-studio/mysql-private /run/invite-studio/mysql-ca /run/invite-studio/maintenance

COPY *.py *.html *.css *.js mysql_schema.sql seed-events.json ./
COPY tools/migrate_mysql.py ./tools/migrate_mysql.py

USER 10001:10001
EXPOSE 8080
CMD ["python", "production.py", "--data-dir", "/run/invite-studio", "--host", "0.0.0.0", "--port", "8080"]
