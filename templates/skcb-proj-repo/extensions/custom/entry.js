export default (services) => ({
  callbacks: {
    'hello': () => {
      console.log('Hello from custom action!');
      window.open('https://github.com', '_blank');
    }
  }
});
