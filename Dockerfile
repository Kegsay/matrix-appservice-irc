# Freebind build
FROM debian:buster-slim as freebind

RUN apt-get update \
 && apt-get install -y git build-essential

RUN git clone https://github.com/matrix-org/freebindfree.git
RUN cd freebindfree && make

# Typescript build
FROM node:20 as builder

WORKDIR /build

COPY src/ /build/src/
COPY widget/ /build/widget/
COPY package.json yarn.lock tsconfig.json .eslintrc /build/

RUN yarn --strict-semver --frozen-lockfile

# install production dependencies only
RUN rm -rf node_modules && yarn cache clean && yarn install --production

# Runtime container image
FROM node:20-slim

RUN apt-get update && apt-get install -y sipcalc iproute2 openssl --no-install-recommends
RUN rm -rf /var/lib/apt/lists/*
RUN mkdir app

WORKDIR /app
RUN mkdir ./data

COPY --from=freebind /freebindfree/libfreebindfree.so /app/libfreebindfree.so
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/package.json /app/package.json
COPY --from=builder /build/lib /app/lib
COPY --from=builder /build/public /app/public

COPY app.js config.schema.yml /app/
COPY docker /app/docker

ENV LD_PRELOAD /app/libfreebindfree.so

ENTRYPOINT ["/app/docker/start.sh"]
