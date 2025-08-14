FROM node:20-alpine as base
WORKDIR /usr/src/app

FROM base as deps
COPY package.json package-lock.json* .npmrc* ./
RUN npm install --production=false

FROM base as build
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine as runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
# App server code
COPY --from=build /usr/src/app/dist ./dist
# Static assets for website
COPY --from=build /usr/src/app/public ./public
COPY --from=build /usr/src/app/images ./images
COPY package.json ./
RUN npm install --omit=dev
EXPOSE 8080
CMD ["node", "dist/index.js"]
