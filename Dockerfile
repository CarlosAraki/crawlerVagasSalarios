FROM node:20

WORKDIR /app

COPY package.json .

RUN npm install

RUN npm install -g nodemon 

COPY . . 

EXPOSE 3333 

CMD ["nodemon","server.js"]


